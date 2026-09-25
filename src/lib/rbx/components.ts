// React Bits — Components (45), rebuilt for video.
//
// Cards, galleries, menus, navigation and controls. In a video there is no user, so every
// component demonstrates itself: rows arrive in reading order, the active item advances on a
// schedule, a scripted cursor presses what needs pressing. Labels come from `rows`; "images" are
// gradient placeholder tiles (external images cannot be exported), so put real footage on its own
// clip with layout_clip when the picture matters.

import {
  CARD_PROPS, N, P_ACCENT, P_ROWS, P_SPEED, P_SUBTITLE, P_TEXT, S,
  accentStyle, bit, card, d, esc, hash, pointerMoment, px, rng, rowsOf, scene, speedOf, splitRow, svg, textOf, tile,
  type Bit,
} from './core';

const P_ACTIVE = { name: 'activeIndex', type: 'number' as const, default: 0, about: 'Which row is current (0-based).' };
const P_SLICE = { name: 'slice', type: 'number' as const, about: 'Seconds each item holds before the next.' };

/** Rows with a moving highlight: each row is visible from its entrance; the highlight steps down on `slice`. */
const listRows = (rows: string[], slice: number, from = 0.2, cls = ''): string =>
  rows.map((r, i) => {
    const { head, rest } = splitRow(r);
    return `<div class="lrow a rise ${cls}" style="${d(from + i * 0.09)}"><div class="lhi a hold lhi-win" style="${d(from + 0.4 + i * slice)};animation-duration:${slice.toFixed(2)}s"></div><span class="small num" style="min-width:${px(50)};color:var(--accent)">${String(i + 1).padStart(2, '0')}</span><div><div class="body" style="font-weight:600">${esc(head)}</div>${rest ? `<div class="small">${esc(rest)}</div>` : ''}</div></div>`;
  }).join('');
const LIST_CSS = `.rbx .lrow{position:relative;display:flex;gap:${px(22)};align-items:center;padding:${px(18)} ${px(26)};border-radius:${px(16)}}.rbx .lhi{position:absolute;inset:0;border-radius:inherit;background:linear-gradient(90deg,var(--accent) 0,var(--accent) ${px(5)},#ffffff12 ${px(5)});opacity:0}.rbx .lhi-win{animation-name:rbx-slot;animation-timing-function:linear}`;

export const COMPONENT_BITS: Bit[] = [
  bit({
    id: 'infinite-spiral', name: 'Infinite Spiral', category: 'component', level: 'advanced',
    about: 'Items spiral endlessly toward the centre.',
    video: 'Labelled tiles sit on a logarithmic spiral that rotates and slowly zooms on a paused loop; the heading holds in the eye of the spiral.',
    use: 'Portfolios, "endless ideas", hypnotic intros.',
    props: [P_TEXT, P_ACCENT, P_SPEED, P_ROWS], example: { text: 'Infinite', rows: ['01', '02', '03', '04', '05', '06', '07', '08'] }, seconds: 6, layout: 'fullscreen', tags: ['gallery', 'loop'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['01', '02', '03', '04', '05', '06', '07', '08']);
      const items = Array.from({ length: 16 }, (_, i) => {
        const ang = i * 0.9;
        const r = 120 + i * 48;
        const s = 0.35 + i * 0.05;
        return `<div class="a pop spitem" style="transform:translate(${px(Math.cos(ang) * r)},${px(Math.sin(ang) * r * 0.62)}) scale(${s.toFixed(2)});${d(0.1 + i * 0.05)};opacity:${(0.35 + i * 0.04).toFixed(2)}">${tile(rows[i % rows.length], i, `width:${px(260)};height:${px(170)}`)}</div>`;
      }).join('');
      return { html: `<div class="x fill" style="${accentStyle(p)}"><div class="fill center"><div class="loop spiralspin" style="position:relative;width:0;height:0;animation-duration:${(30 / speedOf(p)).toFixed(1)}s">${items}</div></div><div class="fill center hero a rise" style="${d(0.6)}">${esc(textOf(p, ctx))}</div></div>`, css: '.rbx .spitem{position:absolute;left:0;top:0;margin:calc(-85px * var(--u)) 0 0 calc(-130px * var(--u))}.rbx .spiralspin{animation-name:rbx-spiral;animation-timing-function:linear}@keyframes rbx-spiral{from{transform:rotate(0) scale(1)}to{transform:rotate(-360deg) scale(1.6)}}' };
    },
  }),
  bit({
    id: 'depth-carousel', name: 'Depth Carousel', category: 'component', level: 'advanced',
    about: 'A coverflow carousel with depth: the centre item is large, the sides recede.',
    video: 'Five tiles slide in from the right and settle into coverflow positions (scaled and dimmed by distance); the centre tile then breathes.',
    use: 'Product lines, episode pickers, portfolios.',
    props: [P_TEXT, P_ACCENT, P_ROWS], example: { text: 'Depth Carousel', rows: ['Ep. 1', 'Ep. 2', 'Ep. 3', 'Ep. 4', 'Ep. 5'] }, seconds: 5, layout: 'fullscreen', tags: ['carousel', '3d'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three', 'Four', 'Five']).slice(0, 7);
      const mid = Math.floor(rows.length / 2);
      const items = rows.map((r, i) => {
        const k = i - mid;
        const scale = 1 - Math.abs(k) * 0.18;
        return `<div class="a dcar" style="--tx:${px(k * 330)};--sc:${scale.toFixed(2)};--op:${(1 - Math.abs(k) * 0.28).toFixed(2)};z-index:${10 - Math.abs(k)};${d(0.1 + Math.abs(k) * 0.12)}">${tile(r, i, `width:${px(420)};height:${px(280)}`)}</div>`;
      }).join('');
      return { html: `<div class="x fill" style="${accentStyle(p)}"><div class="fill center" style="perspective:${px(1600)}">${items}</div><div class="heading a rise" style="position:absolute;left:0;right:0;bottom:${px(80)};text-align:center;${d(0.9)}">${esc(textOf(p, ctx))}</div></div>`, css: '.rbx .dcar{position:absolute;animation-name:rbx-dcar;animation-duration:1s;animation-timing-function:var(--eo)}@keyframes rbx-dcar{from{opacity:0;transform:translateX(calc(var(--tx) + 900px * var(--u))) scale(.5) rotateY(-40deg)}to{opacity:var(--op);transform:translateX(var(--tx)) scale(var(--sc)) rotateY(0)}}' };
    },
  }),
  bit({
    id: 'morph-slider', name: 'Morph Slider', category: 'component', level: 'intermediate',
    about: 'A slider whose thumb and track morph shape as you drag.',
    video: 'A scripted drag moves the thumb from left to right; the thumb stretches into a pill while moving and the fill follows; the value label counts along.',
    use: 'Settings demos, "turn it up" beats, before/after sliders.',
    props: [P_TEXT, P_ACCENT, { name: 'from', type: 'string', default: 'Off', about: 'Left label.' }, { name: 'to', type: 'string', default: 'On', about: 'Right label.' }], example: { text: 'Intensity', from: '0%', to: '100%' }, seconds: 4, tags: ['slider', 'control'],
    build: (p, ctx) => {
      const ptr = pointerMoment('morph', [{ x: 170, y: 340 }, { x: 900, y: 340 }], 0.5, 1.4, false);
      return { html: scene(`<div class="heading a rise" style="position:absolute;left:${px(150)};top:${px(200)};${d(0.05)}">${esc(textOf(p, ctx))}</div><div class="mtrack a fade" style="${d(0.2)}"><div class="mfill a" style="${d(0.5)}"></div><div class="mthumb a" style="${d(0.5)}"></div></div><div class="small" style="position:absolute;left:${px(150)};top:${px(400)}">${esc(S(p, 'from', 'Off'))}</div><div class="small" style="position:absolute;right:${px(150)};top:${px(400)}">${esc(S(p, 'to', 'On'))}</div>${ptr.html}`), css: `${ptr.css}.rbx .mtrack{position:absolute;left:${px(150)};right:${px(150)};top:${px(320)};height:${px(28)};border-radius:999px;background:#ffffff1a;border:1px solid var(--line)}.rbx .mfill{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:linear-gradient(90deg,var(--accent2),var(--accent));animation-name:rbx-mfill;animation-duration:1.4s;animation-timing-function:var(--ei)}.rbx .mthumb{position:absolute;top:${px(-16)};width:${px(60)};height:${px(60)};border-radius:50%;background:#fff;box-shadow:0 ${px(6)} ${px(20)} #0008;animation-name:rbx-mthumb;animation-duration:1.4s;animation-timing-function:var(--ei)}@keyframes rbx-mfill{from{width:3%}to{width:97%}}@keyframes rbx-mthumb{0%{left:0;width:${px(60)};border-radius:50%}50%{width:${px(120)};border-radius:${px(30)}}100%{left:calc(100% - ${px(60)});width:${px(60)};border-radius:50%}}` };
    },
  }),
  bit({
    id: 'drift-wall', name: 'Drift Wall', category: 'component', level: 'intermediate',
    about: 'A wall of media tiles drifts slowly in alternating directions.',
    video: 'Four rows of labelled tiles marquee left/right at different speeds behind the heading, with a dark vignette so the copy reads.',
    use: 'Portfolio walls, "everything we made", event recaps.',
    props: [P_TEXT, P_ACCENT, P_SPEED, P_ROWS], example: { text: 'Drift Wall', rows: ['Shot 01', 'Shot 02', 'Shot 03', 'Shot 04', 'Shot 05', 'Shot 06'] }, seconds: 6, layout: 'fullscreen', tags: ['wall', 'loop'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['01', '02', '03', '04', '05', '06']);
      const line = (i: number) => `<div class="dwrow"><div class="loop ${i % 2 ? 'marquee-r' : 'marquee'}" style="display:inline-flex;gap:${px(20)};animation-duration:${((22 + i * 5) / speedOf(p)).toFixed(1)}s">${rows.concat(rows).map((r, k) => tile(r, k + i * 3, `width:${px(360)};height:${px(220)};flex:none`)).join('')}</div></div>`;
      return { html: `<div class="x fill" style="${accentStyle(p)}"><div class="fill col" style="gap:${px(20)};justify-content:center;opacity:.55">${[0, 1, 2, 3].map(line).join('')}</div><div class="fill" style="background:radial-gradient(ellipse 60% 55% at 50% 50%,#00000099,transparent)"></div><div class="fill center hero a rise" style="${d(0.4)}">${esc(textOf(p, ctx))}</div></div>`, css: '.rbx .dwrow{white-space:nowrap;overflow:hidden}' };
    },
  }),
  bit({
    id: 'accordion-gallery', name: 'Accordion Gallery', category: 'component', level: 'intermediate',
    about: 'Vertical panels; the hovered one expands.',
    video: 'Five panels share the width; each expands in turn on a schedule and shows its label, the last stays open.',
    use: 'Feature tours, portfolio categories, "pick one" beats.',
    props: [P_ACCENT, P_ROWS, P_SLICE], example: { rows: ['Design', 'Motion', 'Sound', 'Edit', 'Ship'] }, seconds: 6, layout: 'fullscreen', tags: ['gallery', 'sequence'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three', 'Four', 'Five']).slice(0, 6);
      const slice = Math.max(0.5, N(p, 'slice', 1));
      const panels = rows.map((r, i) => `<div class="a accpanel ${i === rows.length - 1 ? '' : 'hold'}" style="${d(0.3 + i * slice)};animation-duration:${slice.toFixed(2)}s">${tile(r, i, 'position:absolute;inset:0;border-radius:0')}<div class="acclabel heading">${esc(r)}</div></div>`).join('');
      return { html: `<div class="x fill row" style="gap:${px(8)};${accentStyle(p)}">${panels}</div>`, css: `.rbx .accpanel{position:relative;flex:1 1 0;height:100%;overflow:hidden;animation-name:rbx-acc;animation-timing-function:var(--eo)}.rbx .acclabel{position:absolute;left:${px(40)};bottom:${px(40)};white-space:nowrap;opacity:0;animation:inherit;animation-name:rbx-acclabel}@keyframes rbx-acc{0%{flex-grow:1}12%{flex-grow:5}88%{flex-grow:5}100%{flex-grow:1}}@keyframes rbx-acclabel{0%{opacity:0}18%{opacity:1}85%{opacity:1}100%{opacity:0}}` };
    },
  }),
  bit({
    id: 'specular-button', name: 'Specular Button', category: 'component', level: 'basic',
    about: 'A button with a moving specular highlight.',
    video: 'A large pill button pops in with a travelling highlight; the scripted cursor arrives and presses it.',
    use: 'CTAs, "subscribe", "get started" beats.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT], example: { text: 'Get started', subtitle: 'Free for 14 days' }, seconds: 4, tags: ['button', 'cta'],
    build: (p, ctx) => {
      const ptr = pointerMoment('specbtn', [{ x: 120, y: 540 }, { x: 560, y: 320 }], 0.5, 1.1, true);
      return { html: scene(`<div class="fill center col" style="gap:${px(22)}"><div class="a pop press specbtn" style="${d(0.05)};animation-name:rbx-pop,rbx-press;animation-duration:.5s,.5s;animation-delay:calc(var(--t) + var(--at,0s)),calc(var(--t) + var(--at,0s) + 1.6s)"><span class="specshine loop shimmer"></span>${esc(textOf(p, ctx))}</div>${S(p, 'subtitle') || ctx.subtitle ? `<div class="small a fade" style="${d(0.4)}">${esc(S(p, 'subtitle') || ctx.subtitle)}</div>` : ''}</div>${ptr.html}`), css: `${ptr.css}.rbx .specbtn{position:relative;overflow:hidden;padding:${px(26)} ${px(64)};border-radius:999px;background:linear-gradient(180deg,var(--accent2),var(--accent));color:#fff;font-size:${px(38)};font-weight:700;box-shadow:0 ${px(16)} ${px(40)} #0007,inset 0 1px 0 #fff8}.rbx .specshine{position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,#ffffff66 50%,transparent 70%);background-size:250% 100%}` };
    },
  }),
  bit({
    id: 'option-wheel', name: 'Option Wheel', category: 'component', level: 'intermediate',
    about: 'A vertical wheel picker that spins to a choice.',
    video: 'A column of options scrolls through a window and eases to a stop on the chosen row, which brightens.',
    use: 'Choices, polls, "which one?" beats, slot-style reveals.',
    props: [P_TEXT, P_ACCENT, P_ROWS, P_ACTIVE], example: { text: 'Pick a style', rows: ['Cinematic', 'Playful', 'Editorial', 'Retro', 'Minimal'], activeIndex: 2 }, seconds: 4, tags: ['picker'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three', 'Four', 'Five']);
      const active = Math.min(rows.length - 1, Math.max(0, Math.round(N(p, 'activeIndex', 0))));
      const rowH = 90;
      const list = [...rows, ...rows, ...rows].map((r, i) => `<div class="owrow heading" style="height:${px(rowH)};line-height:${px(rowH)};${i === rows.length + active ? 'color:var(--fg)' : 'color:var(--muted)'}">${esc(r)}</div>`).join('');
      return { html: scene(`<div class="heading a rise" style="position:absolute;left:0;right:0;top:${px(40)};text-align:center;${d(0.05)}">${esc(textOf(p, ctx))}</div><div class="owwin a fade" style="${d(0.1)}"><div class="owlist a" style="--end:${px(-(rows.length + active) * rowH + rowH * 1.5)};${d(0.4)}">${list}</div><div class="owsel"></div></div>`, 1100, 620, accentStyle(p)), css: `.rbx .owwin{position:absolute;left:${px(250)};right:${px(250)};top:${px(200)};height:${px(rowH * 4)};overflow:hidden;text-align:center;mask-image:linear-gradient(180deg,transparent,#000 30%,#000 70%,transparent);-webkit-mask-image:linear-gradient(180deg,transparent,#000 30%,#000 70%,transparent)}.rbx .owlist{animation-name:rbx-owspin;animation-duration:1.8s;animation-timing-function:var(--eo)}.rbx .owsel{position:absolute;left:0;right:0;top:${px(rowH * 1.5)};height:${px(rowH)};border-top:${px(2)} solid var(--accent);border-bottom:${px(2)} solid var(--accent);pointer-events:none}@keyframes rbx-owspin{from{transform:translateY(0)}to{transform:translateY(var(--end))}}` };
    },
  }),
  bit({
    id: 'curved-input', name: 'Curved Input', category: 'component', level: 'basic',
    about: 'A text input with a curved, glowing underline that reacts to focus.',
    video: 'A scripted click focuses the field, the curved underline lights up and the placeholder is typed over.',
    use: 'Search demos, sign-up beats, "type your idea".',
    props: [P_TEXT, P_ACCENT, { name: 'placeholder', type: 'string', default: 'Type here…', about: 'Placeholder before typing.' }, { name: 'label', type: 'string', about: 'Field label.' }], example: { text: 'a channel intro in 15 seconds', label: 'What do you want to make?' }, seconds: 5, tags: ['input', 'form'],
    build: (p, ctx) => {
      const t = textOf(p, ctx);
      const step = 0.055;
      const typed = Array.from(t).map((ch, i) => `<span class="a fade" style="${d(1.1 + i * step)};animation-duration:.05s">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('');
      const ptr = pointerMoment('cinput', [{ x: 150, y: 560 }, { x: 520, y: 320 }], 0.3, 0.7, true);
      return { html: scene(`${S(p, 'label') ? `<div class="kicker a rise" style="position:absolute;left:${px(150)};top:${px(210)};${d(0.05)}">${esc(S(p, 'label'))}</div>` : ''}<div class="cinput a rise" style="${d(0.1)}"><div class="body" style="position:relative"><span class="a cph" style="${d(1.05)}">${esc(S(p, 'placeholder', 'Type here…'))}</span><span style="position:absolute;left:0;top:0">${typed}<span class="a fade" style="${d(1.0)}"><span class="loop blink" style="color:var(--accent)">|</span></span></span></div>${svg('<path class="a cline" pathLength="1" d="M0,20 Q500,-12 1000,20" style="' + d(1.0) + '"/>', { vb: '0 0 1000 40', style: 'top:auto;bottom:-4px;height:40px;fill:none;stroke:var(--accent);stroke-width:4;stroke-linecap:round' })}</div>${ptr.html}`), css: `${ptr.css}.rbx .cinput{position:absolute;left:${px(150)};right:${px(150)};top:${px(290)};padding:${px(20)} ${px(10)} ${px(28)};border-bottom:1px solid var(--line)}.rbx .cph{color:var(--muted);animation-name:rbx-fadeout;animation-duration:.2s}.rbx .cline{stroke-dasharray:1;stroke-dashoffset:1;animation-name:rbx-draw;animation-duration:.6s;animation-timing-function:var(--eo)}@keyframes rbx-fadeout{from{opacity:1}to{opacity:0}}` };
    },
  }),
  bit({
    id: 'line-sidebar', name: 'Line Sidebar', category: 'component', level: 'basic',
    about: 'A minimal sidebar of lines that expand into labels on hover.',
    video: 'Short lines stack at the left edge; each grows into its label in turn, the current one in accent.',
    use: 'Chapter lists, agendas, "in this video".',
    props: [P_ACCENT, P_ROWS, P_ACTIVE], example: { rows: ['Intro', 'The problem', 'The fix', 'Results', 'Outro'], activeIndex: 2 }, seconds: 5, layout: 'side-panel-left', tags: ['nav', 'chapters'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three', 'Four']);
      const active = Math.min(rows.length - 1, Math.max(0, Math.round(N(p, 'activeIndex', 0))));
      return { html: `<div class="x col" style="gap:${px(26)};${accentStyle(p)}">${rows.map((r, i) => `<div class="row lsrow" style="gap:${px(18)}"><i class="lsline a grow-x" style="${d(0.1 + i * 0.08)};${i === active ? 'background:var(--accent)' : ''}"></i><span class="body a slide-l ${i === active ? '' : ''}" style="${d(0.6 + i * 0.12)};${i === active ? 'color:var(--fg);font-weight:700' : 'color:var(--muted)'}">${esc(r)}</span></div>`).join('')}</div>`, css: `.rbx .lsline{display:block;width:${px(60)};height:${px(4)};border-radius:2px;background:var(--line)}` };
    },
  }),
  bit({
    id: 'animated-list', name: 'Animated List', category: 'component', level: 'basic',
    about: 'A list whose items animate in and highlight on hover/keyboard.',
    video: 'Rows slide in with a stagger and a highlight bar steps down the list on a schedule.',
    use: 'Steps, features, "three things", agendas.',
    props: [P_TEXT, P_ACCENT, P_ROWS, P_SLICE], example: { text: 'Today', rows: ['Plan — the promise and the beats', 'Gather — every shot and sound', 'Edit — cut, level, sync', 'Polish — QA the frames'] }, seconds: 6, tags: ['list'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One — first', 'Two — second', 'Three — third']);
      const slice = Math.max(0.4, N(p, 'slice', 0.9));
      return { html: scene(`<div class="glass col" style="position:absolute;inset:0;padding:${px(36)} ${px(40)};gap:${px(6)}"><div class="heading a rise" style="margin-bottom:${px(14)};${d(0.05)}">${esc(textOf(p, ctx))}</div>${listRows(rows, slice, 0.25)}</div>`, 1000, Math.min(900, 160 + rows.length * 112), accentStyle(p)), css: LIST_CSS };
    },
  }),
  bit({
    id: 'scroll-stack', name: 'Scroll Stack', category: 'component', level: 'intermediate',
    about: 'Cards stack on top of each other as you scroll.',
    video: 'Cards slide up from below one after another and settle into a stepped stack; earlier cards scale back slightly.',
    use: 'Layered arguments, "and then…", pricing tiers.',
    props: [P_ACCENT, P_ROWS], example: { rows: ['Idea — one sentence', 'Script — the beats', 'Footage — 5–7 s shots', 'Edit — on the music'] }, seconds: 6, tags: ['cards', 'stack'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One — a', 'Two — b', 'Three — c']).slice(0, 6);
      const n = rows.length;
      const cards = rows.map((r, i) => {
        const { head, rest } = splitRow(r);
        const k = n - 1 - i;
        return `<div class="glass a stackcard" style="--ty:${px(-k * 34)};--sc:${(1 - k * 0.04).toFixed(2)};z-index:${i};${d(0.2 + i * 0.5)}"><div class="kicker">0${i + 1}</div><div class="heading" style="font-size:${px(54)}">${esc(head)}</div>${rest ? `<div class="small" style="margin-top:${px(8)}">${esc(rest)}</div>` : ''}</div>`;
      }).join('');
      return { html: scene(`<div class="fill" style="display:flex;align-items:flex-end;justify-content:center;padding-bottom:${px(40)}">${cards}</div>`, 1100, 640, accentStyle(p)), css: `.rbx .stackcard{position:absolute;bottom:${px(40)};width:${px(760)};padding:${px(34)} ${px(44)};animation-name:rbx-stackcard;animation-duration:.8s;animation-timing-function:var(--eo)}@keyframes rbx-stackcard{from{opacity:0;transform:translateY(120%) scale(1)}to{opacity:1;transform:translateY(var(--ty)) scale(var(--sc))}}` };
    },
  }),
  bit({
    id: 'bubble-menu', name: 'Bubble Menu', category: 'component', level: 'intermediate',
    about: 'A menu whose items burst out as bubbles.',
    video: 'The scripted cursor presses the round menu button; bubbles (rows) spring out around it in an arc.',
    use: 'App feature reveals, playful menus, "one tap" beats.',
    props: [P_ACCENT, P_ROWS], example: { rows: ['Home', 'Work', 'About', 'Blog', 'Contact'] }, seconds: 4, tags: ['menu', 'spring'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['Home', 'Work', 'About', 'Contact']).slice(0, 6);
      const ptr = pointerMoment('bubble', [{ x: 120, y: 560 }, { x: 550, y: 330 }], 0.3, 0.9, true);
      const bubbles = rows.map((r, i) => {
        const ang = Math.PI + (Math.PI * (i + 0.5)) / rows.length;
        return `<div class="pill a bubble" style="--bx:${px(Math.cos(ang) * 320)};--by:${px(Math.sin(ang) * 220 - 40)};${d(1.3 + i * 0.07)};font-size:${px(30)};padding:${px(16)} ${px(34)}">${esc(r)}</div>`;
      }).join('');
      return { html: scene(`<div class="fill center"><div class="bubblebtn a pop press" style="${d(0.05)};animation-name:rbx-pop,rbx-press;animation-duration:.5s,.4s;animation-delay:calc(var(--t) + var(--at,0s)),calc(var(--t) + var(--at,0s) + 1.2s)">☰</div>${bubbles}</div>${ptr.html}`), css: `${ptr.css}.rbx .bubblebtn{width:${px(110)};height:${px(110)};border-radius:50%;background:var(--accent);color:#fff;font-size:${px(44)};display:flex;align-items:center;justify-content:center;box-shadow:0 ${px(14)} ${px(40)} #0007}.rbx .bubble{position:absolute;animation-name:rbx-bubble;animation-duration:.7s;animation-timing-function:var(--spring)}@keyframes rbx-bubble{from{opacity:0;transform:translate(0,0) scale(.3)}to{opacity:1;transform:translate(var(--bx),var(--by)) scale(1)}}` };
    },
  }),
  bit({
    id: 'magic-bento', name: 'Magic Bento', category: 'component', level: 'intermediate',
    about: 'A bento grid with spotlight, border glow and particle effects.',
    video: 'Bento tiles cascade in; a spotlight sweeps across the grid; each tile shows a heading and one line.',
    use: 'Feature lineups, pricing, recaps, "what you get".',
    props: [P_TEXT, P_ACCENT, P_ROWS], example: { text: 'Everything included', rows: ['Plan — research, script, beats', 'Gather — shots, voice, music', 'Edit — cuts on the beat', 'Graphics — Crimson & React Bits', 'QA — every frame checked', 'Export — rendered frames'] }, seconds: 6, layout: 'fullscreen', tags: ['grid', 'features'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One — a', 'Two — b', 'Three — c', 'Four — d', 'Five — e', 'Six — f']).slice(0, 6);
      const tiles = rows.map((r, i) => {
        const { head, rest } = splitRow(r);
        return `<div class="glass a pop bento" style="grid-column:${i === 0 || i === 4 ? 'span 2' : 'span 1'};${d(0.2 + i * 0.1)}"><div class="kicker">0${i + 1}</div><div class="heading" style="font-size:${px(44)};margin-top:${px(8)}">${esc(head)}</div>${rest ? `<div class="small" style="margin-top:${px(6)}">${esc(rest)}</div>` : ''}</div>`;
      }).join('');
      return { html: `<div class="x fill col" style="padding:${px(90)} ${px(140)};gap:${px(26)};${accentStyle(p)}"><div class="heading a rise" style="${d(0.05)}">${esc(textOf(p, ctx))}</div><div class="bentogrid" style="position:relative">${tiles}<div class="spot a" style="${d(0.9)}"></div></div></div>`, css: `.rbx .bentogrid{display:grid;grid-template-columns:repeat(4,1fr);gap:${px(22)};flex:1}.rbx .bento{padding:${px(30)} ${px(34)};overflow:hidden}.rbx .spot{position:absolute;top:-20%;bottom:-20%;left:-30%;width:30%;background:linear-gradient(90deg,transparent,var(--accent),transparent);opacity:.18;filter:blur(${px(30)});animation-name:rbx-glare;animation-duration:1.8s;animation-timing-function:var(--ei);pointer-events:none}@keyframes rbx-glare{from{left:-30%}to{left:130%}}` };
    },
  }),
  bit({
    id: 'circular-gallery', name: 'Circular Gallery', category: 'component', level: 'intermediate',
    about: 'Images on a curved, draggable strip that bends around the viewer.',
    video: 'Tiles sit on a wide arc, tilted toward the centre; the arc rotates slowly on a loop under the heading.',
    use: 'Teams, casts, panels, portfolios.',
    props: [P_TEXT, P_ACCENT, P_SPEED, P_ROWS], example: { text: 'The team', rows: ['Ana', 'Ben', 'Chloe', 'Dev', 'Eli', 'Fay'] }, seconds: 6, layout: 'fullscreen', tags: ['gallery', 'loop'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three', 'Four', 'Five', 'Six']);
      const n = Math.max(rows.length, 6);
      const items = Array.from({ length: n }, (_, i) => `<div class="a pop cgitem" style="transform:rotate(${((i * 360) / n).toFixed(1)}deg) translateY(${px(-1500)}) rotate(0);${d(0.15 + i * 0.06)}">${tile(rows[i % rows.length], i, `width:${px(340)};height:${px(240)}`)}</div>`).join('');
      return { html: `<div class="x fill" style="${accentStyle(p)}"><div class="cgring loop cgspin" style="animation-duration:${(60 / speedOf(p)).toFixed(1)}s">${items}</div><div class="heading a rise" style="position:absolute;left:0;right:0;top:${px(120)};text-align:center;${d(0.05)}">${esc(textOf(p, ctx))}</div></div>`, css: `.rbx .cgring{position:absolute;left:50%;top:${px(1900)};width:0;height:0}.rbx .cgitem{position:absolute;left:0;top:0;margin:calc(-120px * var(--u)) 0 0 calc(-170px * var(--u))}.rbx .cgspin{animation-name:rbx-cgspin;animation-timing-function:linear}@keyframes rbx-cgspin{from{transform:rotate(-14deg)}to{transform:rotate(14deg)}}` };
    },
  }),
  bit({
    id: 'reflective-card', name: 'Reflective Card', category: 'component', level: 'intermediate',
    about: 'A card with a light reflection that follows the tilt.',
    video: 'The card tilts gently on a loop while a diagonal reflection band crosses it in sync.',
    use: 'Premium product cards, membership tiers, NFTs-without-the-NFT.',
    props: [...CARD_PROPS, P_SPEED], example: { text: 'Reflective Card', kicker: 'MEMBER', subtitle: 'Since 2024' }, seconds: 5, tags: ['card', 'loop'],
    build: (p, ctx) => ({ html: scene(`<div class="fill center" style="perspective:${px(1400)}"><div class="a pop reflwrap loop" style="${d(0.05)};animation-name:rbx-pop,rbx-refltilt;animation-duration:.5s,${(4 / speedOf(p)).toFixed(1)}s;animation-iteration-count:1,infinite;animation-timing-function:var(--spring),ease-in-out">${card(p, ctx)}<div class="reflband loop" style="animation-duration:${(4 / speedOf(p)).toFixed(1)}s"></div></div></div>`), css: '.rbx .reflwrap{position:relative;overflow:hidden;border-radius:calc(24px * var(--u));transform-style:preserve-3d}.rbx .reflband{position:absolute;top:-30%;bottom:-30%;width:30%;background:linear-gradient(100deg,transparent,#ffffff2e 50%,transparent);animation-name:rbx-reflband;animation-timing-function:ease-in-out;pointer-events:none}@keyframes rbx-refltilt{0%,100%{transform:rotateY(-8deg) rotateX(4deg)}50%{transform:rotateY(8deg) rotateX(-4deg)}}@keyframes rbx-reflband{0%,100%{left:-30%}50%{left:100%}}' }),
  }),
  bit({
    id: 'card-nav', name: 'Card Nav', category: 'component', level: 'basic',
    about: 'A nav bar that expands downward into cards.',
    video: 'A slim bar with the brand name slides in; a scripted click on the menu icon drops three cards out beneath it.',
    use: 'Website tours, app demos, "here is what is inside".',
    props: [P_TEXT, P_ACCENT, P_ROWS], example: { text: 'Bhippi', rows: ['Features — what it does', 'Pricing — what it costs', 'Docs — how it works'] }, seconds: 5, tags: ['nav', 'cards'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One — a', 'Two — b', 'Three — c']).slice(0, 4);
      const ptr = pointerMoment('cardnav', [{ x: 200, y: 560 }, { x: 990, y: 140 }], 0.4, 0.9, true);
      const cards = rows.map((r, i) => { const { head, rest } = splitRow(r); return `<div class="glass a cnavcard" style="${d(1.5 + i * 0.12)}"><div class="heading" style="font-size:${px(40)}">${esc(head)}</div>${rest ? `<div class="small" style="margin-top:${px(6)}">${esc(rest)}</div>` : ''}</div>`; }).join('');
      return { html: scene(`<div class="glass a drop cnavbar" style="${d(0.05)}"><div class="heading" style="font-size:${px(40)}">${esc(textOf(p, ctx))}</div><div style="font-size:${px(40)}">☰</div></div><div class="cnavcards">${cards}</div>${ptr.html}`, 1100, 620, accentStyle(p)), css: `${ptr.css}.rbx .cnavbar{position:absolute;left:${px(60)};right:${px(60)};top:${px(90)};display:flex;justify-content:space-between;align-items:center;padding:${px(24)} ${px(40)}}.rbx .cnavcards{position:absolute;left:${px(60)};right:${px(60)};top:${px(220)};display:grid;grid-template-columns:repeat(${rows.length},1fr);gap:${px(20)}}.rbx .cnavcard{padding:${px(28)} ${px(32)};animation-name:rbx-cnavcard;animation-duration:.6s;animation-timing-function:var(--eo)}@keyframes rbx-cnavcard{from{opacity:0;transform:translateY(-40%) scaleY(.6);transform-origin:50% 0}to{opacity:1;transform:none}}` };
    },
  }),
  bit({
    id: 'stack', name: 'Stack', category: 'component', level: 'intermediate',
    about: 'A draggable deck of cards; the top card swipes away to reveal the next.',
    video: 'A deck of tilted cards; on a schedule the top card flies off to the right and the next one settles forward.',
    use: 'Testimonials, tips in sequence, swipe metaphors.',
    props: [P_ACCENT, P_ROWS, P_SLICE], example: { rows: ['"Best tool I have used" — Ana', '"Saved me hours" — Ben', '"It just works" — Chloe'] }, seconds: 6, tags: ['cards', 'deck'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One — a', 'Two — b', 'Three — c']).slice(0, 5);
      const slice = Math.max(0.6, N(p, 'slice', 1.4));
      const n = rows.length;
      const cards = rows.map((r, i) => {
        const { head, rest } = splitRow(r);
        const depth = i;
        return `<div class="glass a stkcard ${i === n - 1 ? 'stkstay' : ''}" style="z-index:${n - i};--rot:${((depth % 2 ? 1 : -1) * (2 + depth * 2)).toFixed(0)}deg;--tyd:${px(depth * 18)};${d(0.5 + i * slice)};animation-duration:${slice.toFixed(2)}s"><div class="heading" style="font-size:${px(46)}">${esc(head)}</div>${rest ? `<div class="small" style="margin-top:${px(14)}">${esc(rest)}</div>` : ''}</div>`;
      }).join('');
      return { html: scene(`<div class="fill center a pop" style="${d(0.05)}">${cards}</div>`, 1100, 620, accentStyle(p)), css: `.rbx .stkcard{position:absolute;width:${px(680)};padding:${px(44)} ${px(52)};transform:rotate(var(--rot)) translateY(var(--tyd));animation-name:rbx-stkfly;animation-timing-function:var(--ei);animation-fill-mode:forwards}.rbx .stkstay{animation-name:none}@keyframes rbx-stkfly{0%,70%{opacity:1;transform:rotate(var(--rot)) translateY(var(--tyd))}100%{opacity:0;transform:rotate(18deg) translate(${px(700)},${px(-120)})}}` };
    },
  }),
  bit({
    id: 'fluid-glass', name: 'Fluid Glass', category: 'component', level: 'advanced',
    about: 'A glass lens that refracts the content behind it as it moves.',
    video: 'A rounded glass lens with rim highlights travels across the heading on a loop; the type under it shifts and brightens to suggest refraction.',
    use: 'Premium tech, optics, "look closer" beats.',
    props: [P_TEXT, P_ACCENT, P_SPEED], example: { text: 'Fluid Glass' }, seconds: 5, tags: ['glass', 'loop'],
    build: (p, ctx) => ({ html: scene(`<div class="fill center display a rise" style="${d(0.05)}">${esc(textOf(p, ctx))}</div><div class="fglens loop" style="animation-duration:${(5 / speedOf(p)).toFixed(1)}s"><div class="fill center display fgdup loop" style="animation-duration:${(5 / speedOf(p)).toFixed(1)}s">${esc(textOf(p, ctx))}</div></div>`, 1100, 620, accentStyle(p)), css: `.rbx .fglens{position:absolute;top:50%;left:0;width:${px(300)};height:${px(300)};margin-top:${px(-150)};border-radius:50%;overflow:hidden;border:${px(2)} solid #ffffff66;box-shadow:inset 0 0 ${px(40)} #ffffff33,inset ${px(-12)} ${px(-12)} ${px(30)} #ffffff44,0 ${px(20)} ${px(60)} #0008;background:#ffffff0a;animation-name:rbx-fglens;animation-timing-function:ease-in-out}.rbx .fgdup{width:${px(1100)};height:${px(620)};left:auto;top:${px(-160)};color:var(--accent2);transform:scale(1.18);animation-name:rbx-fgdup;animation-timing-function:ease-in-out}@keyframes rbx-fglens{0%,100%{left:${px(80)}}50%{left:${px(720)}}}@keyframes rbx-fgdup{0%,100%{left:${px(-80)}}50%{left:${px(-720)}}}` }),
  }),
  bit({
    id: 'pill-nav', name: 'Pill Nav', category: 'component', level: 'basic',
    about: 'Pill-shaped navigation with a sliding active indicator.',
    video: 'A pill bar drops in; the active pill glides across the items on a schedule.',
    use: 'Tabs, sections, "we cover these".',
    props: [P_ACCENT, P_ROWS, P_SLICE], example: { rows: ['Plan', 'Gather', 'Edit', 'Polish'] }, seconds: 5, layout: 'top-left', tags: ['nav', 'tabs'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three', 'Four']).slice(0, 6);
      const slice = Math.max(0.4, N(p, 'slice', 0.9));
      const w = 100 / rows.length;
      const frames = rows.map((_, i) => `${Math.round((i / rows.length) * 100)}%,${Math.round(((i + 0.85) / rows.length) * 100)}%{left:${(i * w).toFixed(2)}%}`).join('');
      return { html: `<div class="x glass a drop pillnav" style="${d(0.05)};width:${px(Math.max(560, rows.length * 190))}"><div class="pillact a" style="width:${w.toFixed(2)}%;${d(0.5)};animation-duration:${(slice * rows.length).toFixed(2)}s"></div>${rows.map((r) => `<div class="body pillitem" style="width:${w.toFixed(2)}%">${esc(r)}</div>`).join('')}</div>`, css: `.rbx .pillnav{position:relative;display:flex;padding:${px(8)};border-radius:999px}.rbx .pillitem{position:relative;z-index:1;text-align:center;padding:${px(16)} 0;font-weight:600}.rbx .pillact{position:absolute;top:${px(8)};bottom:${px(8)};border-radius:999px;background:var(--accent);animation-name:rbx-pillact;animation-timing-function:var(--eo)}@keyframes rbx-pillact{${frames}100%{left:${((rows.length - 1) * w).toFixed(2)}%}}` };
    },
  }),
  bit({
    id: 'tilted-card', name: 'Tilted Card', category: 'component', level: 'basic',
    about: 'A card that tilts in 3D toward the pointer.',
    video: 'The card pops in, tilts toward the scripted cursor as it passes, then settles flat.',
    use: 'Product highlights, thumbnails, one-card reveals.',
    props: CARD_PROPS, example: { text: 'Tilted Card', subtitle: 'Leans toward the hand' }, seconds: 4, tags: ['card', '3d'],
    build: (p, ctx) => {
      const ptr = pointerMoment('tilt', [{ x: 80, y: 560 }, { x: 300, y: 200 }, { x: 800, y: 420 }, { x: 1050, y: 600 }], 0.5, 1.8, false);
      return { html: scene(`<div class="fill center" style="perspective:${px(1200)}"><div class="a tiltcard" style="${d(0.5)}"><div class="a pop" style="${d(0.05)}">${card(p, ctx)}</div></div></div>${ptr.html}`), css: `${ptr.css}.rbx .tiltcard{animation-name:rbx-tiltcard;animation-duration:1.8s;animation-timing-function:var(--ei);transform-style:preserve-3d}@keyframes rbx-tiltcard{0%{transform:rotateX(0) rotateY(0)}30%{transform:rotateX(10deg) rotateY(-12deg)}70%{transform:rotateX(-8deg) rotateY(12deg)}100%{transform:rotateX(0) rotateY(0)}}` };
    },
  }),
  bit({
    id: 'masonry', name: 'Masonry', category: 'component', level: 'intermediate',
    about: 'A responsive masonry grid of images that animates in.',
    video: 'Three columns of tiles with varied heights drop into place with a stagger; the heading sits over a vignette.',
    use: 'Galleries, mood boards, recaps.',
    props: [P_TEXT, P_ACCENT, P_ROWS], example: { text: 'Mood board', rows: ['Light', 'Colour', 'Texture', 'Type', 'Grain', 'Motion', 'Sound', 'Edit', 'Grade'] }, seconds: 5, layout: 'fullscreen', tags: ['gallery', 'grid'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['01', '02', '03', '04', '05', '06', '07', '08', '09']);
      const rand = rng(hash(textOf(p, ctx)));
      const cols = [0, 1, 2].map((c) => `<div class="col" style="flex:1;gap:${px(20)}">${rows.filter((_, i) => i % 3 === c).map((r, k) => `<div class="a drop" style="${d(0.1 + (k * 3 + c) * 0.07)}">${tile(r, k * 3 + c, `width:100%;height:${px(180 + Math.round(rand() * 200))}`)}</div>`).join('')}</div>`).join('');
      return { html: `<div class="x fill" style="${accentStyle(p)}"><div class="fill row" style="align-items:flex-start;gap:${px(20)};padding:${px(60)} ${px(160)};opacity:.85">${cols}</div><div class="fill" style="background:radial-gradient(ellipse 50% 40% at 50% 50%,#000000aa,transparent)"></div><div class="fill center hero a rise" style="${d(0.8)}">${esc(textOf(p, ctx))}</div></div>` };
    },
  }),
  bit({
    id: 'glass-surface', name: 'Glass Surface', category: 'component', level: 'basic',
    about: 'A frosted glass panel with refraction and edge lighting.',
    video: 'A large glass panel eases in behind the copy with animated rim highlights (no backdrop-filter: layered fills and rims).',
    use: 'Quotes, section cards, anything that needs a surface over footage.',
    props: [...CARD_PROPS, P_ROWS], example: { text: 'Glass Surface', subtitle: 'Frosted, layered, exportable' }, seconds: 5, tags: ['glass', 'panel'],
    build: (p, ctx) => ({ html: scene(`<div class="fill center"><div class="a pop gsurf" style="${d(0.05)}"><div class="gsrim loop shimmer"></div>${card(p, ctx, '', 'min-width:0;border:0;background:transparent;box-shadow:none;padding:' + px(60) + ' ' + px(80))}${rowsOf(p, ctx, []).map((r, i) => `<div class="body a rise" style="padding:0 ${px(80)} ${px(14)};${d(0.5 + i * 0.12)}">• ${esc(r)}</div>`).join('')}</div></div>`), css: `.rbx .gsurf{position:relative;border-radius:${px(36)};background:linear-gradient(135deg,#ffffff1f,#ffffff08 40%,#ffffff14),var(--card);box-shadow:inset 0 1px 0 #ffffff88,inset 0 -1px 0 #ffffff22,0 ${px(30)} ${px(90)} #00000077;padding-bottom:${px(30)}}.rbx .gsrim{position:absolute;inset:0;border-radius:inherit;padding:${px(2)};background:linear-gradient(120deg,#ffffff00 20%,#ffffffaa 45%,#ffffff00 55%,#ffffff66 80%);background-size:250% 100%;-webkit-mask:linear-gradient(#000,#000) content-box,linear-gradient(#000,#000);-webkit-mask-composite:xor;mask:linear-gradient(#000,#000) content-box,linear-gradient(#000,#000);mask-composite:exclude}` }),
  }),
  bit({
    id: 'dome-gallery', name: 'Dome Gallery', category: 'component', level: 'advanced',
    about: 'Images wrap around the inside of a dome you can drag.',
    video: 'A 3D grid of tiles curved around the viewer (perspective + rotateY per column, rotateX per row) turning slowly, with the heading in front.',
    use: 'Immersive galleries, event recaps, "all around you".',
    props: [P_TEXT, P_ACCENT, P_SPEED, P_ROWS], example: { text: 'Dome Gallery', rows: ['01', '02', '03', '04', '05', '06', '07', '08'] }, seconds: 6, layout: 'fullscreen', tags: ['gallery', '3d', 'loop'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['01', '02', '03', '04', '05', '06', '07', '08']);
      const tiles: string[] = [];
      for (let r = -1; r <= 1; r++) for (let c = -4; c <= 4; c++) tiles.push(`<div class="a fade dometile" style="transform:rotateY(${c * 22}deg) rotateX(${-r * 26}deg) translateZ(${px(-1500)});${d(0.1 + (Math.abs(c) + Math.abs(r)) * 0.08)}">${tile(rows[(Math.abs(r * 9 + c + 13)) % rows.length], r * 9 + c + 13, `width:${px(420)};height:${px(280)}`)}</div>`);
      return { html: `<div class="x fill" style="${accentStyle(p)}"><div class="fill center" style="perspective:${px(1500)}"><div class="domering loop" style="animation-duration:${(40 / speedOf(p)).toFixed(1)}s">${tiles.join('')}</div></div><div class="fill center hero a rise" style="${d(0.6)}">${esc(textOf(p, ctx))}</div></div>`, css: `.rbx .domering{position:relative;width:0;height:0;transform-style:preserve-3d;animation-name:rbx-domering;animation-timing-function:linear}.rbx .dometile{position:absolute;left:0;top:0;margin:calc(-140px * var(--u)) 0 0 calc(-210px * var(--u));transform-origin:50% 50%;backface-visibility:hidden}@keyframes rbx-domering{from{transform:rotateY(-8deg)}to{transform:rotateY(8deg)}}` };
    },
  }),
  bit({
    id: 'chroma-grid', name: 'Chroma Grid', category: 'component', level: 'intermediate',
    about: 'A grid of profile cards in greyscale that gain colour under a spotlight.',
    video: 'Six cards enter grey; a spotlight travels across the grid and each card takes its colour as the light passes, staying coloured.',
    use: 'Teams, speakers, "meet the crew".',
    props: [P_TEXT, P_ACCENT, P_ROWS], example: { text: 'Meet the crew', rows: ['Ana — Director', 'Ben — Editor', 'Chloe — Sound', 'Dev — Colour', 'Eli — Motion', 'Fay — Producer'] }, seconds: 6, layout: 'fullscreen', tags: ['grid', 'people'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One — a', 'Two — b', 'Three — c', 'Four — d', 'Five — e', 'Six — f']).slice(0, 6);
      const cards = rows.map((r, i) => { const { head, rest } = splitRow(r); return `<div class="a rise chroma" style="${d(0.1 + i * 0.08)}"><div class="a chromacol" style="${d(0.9 + (i % 3) * 0.35 + Math.floor(i / 3) * 0.15)}">${tile(head, i, `width:100%;height:${px(220)}`)}<div class="body" style="margin-top:${px(14)};font-weight:700">${esc(head)}</div>${rest ? `<div class="small">${esc(rest)}</div>` : ''}</div></div>`; }).join('');
      return { html: `<div class="x fill col" style="padding:${px(80)} ${px(160)};gap:${px(28)};${accentStyle(p)}"><div class="heading a rise" style="${d(0.05)}">${esc(textOf(p, ctx))}</div><div class="chromagrid">${cards}</div></div>`, css: `.rbx .chromagrid{display:grid;grid-template-columns:repeat(3,1fr);gap:${px(28)};flex:1}.rbx .chromacol{filter:grayscale(1) brightness(.7);animation-name:rbx-chroma;animation-duration:.7s;animation-timing-function:var(--eo)}@keyframes rbx-chroma{from{filter:grayscale(1) brightness(.7)}to{filter:grayscale(0) brightness(1)}}` };
    },
  }),
  bit({
    id: 'folder', name: 'Folder', category: 'component', level: 'intermediate',
    about: 'A folder that opens to fan out its papers on hover.',
    video: 'A folder pops in; its flap opens and three papers (rows) fan upward with a spring, then hold.',
    use: 'Portfolios, "inside the pack", downloads, case files.',
    props: [P_TEXT, P_ACCENT, P_ROWS], example: { text: 'Case file', rows: ['Brief', 'Script', 'Shot list'] }, seconds: 4, tags: ['folder', 'spring'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three']).slice(0, 3);
      const papers = rows.map((r, i) => `<div class="paper a" style="--rot:${(i - 1) * 16}deg;--tx:${px((i - 1) * 120)};${d(0.9 + i * 0.08)}"><div class="small" style="color:#333;font-weight:700">${esc(r)}</div></div>`).join('');
      return { html: scene(`<div class="fill center col" style="gap:${px(30)}"><div class="folderwrap a pop" style="${d(0.05)}"><div class="folderback"></div>${papers}<div class="folderfront a" style="${d(0.8)}"></div></div><div class="heading a rise" style="${d(0.3)}">${esc(textOf(p, ctx))}</div></div>`, 1100, 620, accentStyle(p)), css: `.rbx .folderwrap{position:relative;width:${px(360)};height:${px(260)}}.rbx .folderback,.rbx .folderfront{position:absolute;left:0;right:0;bottom:0;border-radius:${px(18)}}.rbx .folderback{top:0;background:var(--accent);filter:brightness(.7)}.rbx .folderback:before{content:"";position:absolute;left:0;top:${px(-26)};width:40%;height:${px(40)};border-radius:${px(12)} ${px(12)} 0 0;background:inherit}.rbx .folderfront{height:78%;background:var(--accent);transform-origin:50% 100%;animation-name:rbx-folderopen;animation-duration:.7s;animation-timing-function:var(--spring);box-shadow:0 ${px(-6)} ${px(20)} #0004}.rbx .paper{position:absolute;left:12%;right:12%;bottom:12%;height:70%;border-radius:${px(10)};background:#fbf7f2;padding:${px(18)};transform-origin:50% 100%;animation-name:rbx-paper;animation-duration:.8s;animation-timing-function:var(--spring);box-shadow:0 ${px(8)} ${px(24)} #0005}@keyframes rbx-folderopen{from{transform:perspective(900px) rotateX(0)}to{transform:perspective(900px) rotateX(-28deg)}}@keyframes rbx-paper{from{transform:translateY(0) rotate(0)}to{transform:translate(var(--tx),${px(-140)}) rotate(var(--rot))}}` };
    },
  }),
  bit({
    id: 'staggered-menu', name: 'Staggered Menu', category: 'component', level: 'basic',
    about: 'A full-screen menu whose items stagger in behind sliding panels.',
    video: 'Two slanted panels sweep in from the right, then the menu items rise with a stagger, numbered.',
    use: 'Chapter menus, "in this video", agenda cards.',
    props: [P_ACCENT, P_ROWS], example: { rows: ['Intro', 'The setup', 'The twist', 'What it means', 'Outro'] }, seconds: 5, layout: 'fullscreen', tags: ['menu', 'panels'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three', 'Four']).slice(0, 7);
      return { html: `<div class="x fill" style="${accentStyle(p)}"><div class="smpanel a" style="background:var(--accent);${d(0.05)}"></div><div class="smpanel a" style="background:var(--card);${d(0.18)}"></div><div class="fill col" style="justify-content:center;align-items:flex-end;padding-right:12%;gap:${px(14)}">${rows.map((r, i) => `<div class="row a rise" style="gap:${px(26)};${d(0.6 + i * 0.09)}"><span class="hero" style="font-size:${px(64)}">${esc(r)}</span><span class="small num">0${i + 1}</span></div>`).join('')}</div></div>`, css: '.rbx .smpanel{position:absolute;top:0;bottom:0;left:40%;right:0;transform-origin:100% 50%;animation-name:rbx-smpanel;animation-duration:.8s;animation-timing-function:var(--eo);clip-path:polygon(18% 0,100% 0,100% 100%,0 100%)}@keyframes rbx-smpanel{from{transform:translateX(100%)}to{transform:translateX(0)}}' };
    },
  }),
  bit({
    id: 'model-viewer', name: 'Model Viewer', category: 'component', level: 'advanced',
    about: 'An interactive 3D model viewer.',
    video: 'A CSS cube (six faces, glass + accent) turns slowly on two axes on a loop with a floor shadow; the label sits under it. A stand-in for a real model.',
    use: 'Product stand-ins, "3D" flourishes, tech idents.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT, P_SPEED, { name: 'size', type: 'number', default: 260, about: 'Cube edge in design px.' }], example: { text: 'Model Viewer', subtitle: 'Drag to rotate' }, seconds: 6, tags: ['3d', 'loop'],
    build: (p, ctx) => {
      const s = N(p, 'size', 260);
      const faces = ['rotateY(0)', 'rotateY(90deg)', 'rotateY(180deg)', 'rotateY(-90deg)', 'rotateX(90deg)', 'rotateX(-90deg)'].map((rot, i) => `<div class="cubeface" style="transform:${rot} translateZ(${px(s / 2)});${i % 2 ? 'background:linear-gradient(135deg,var(--accent),var(--card))' : ''}"></div>`).join('');
      return { html: scene(`<div class="fill center col" style="gap:${px(40)}"><div class="a pop" style="perspective:${px(1400)};${d(0.05)}"><div class="cube3 loop" style="width:${px(s)};height:${px(s)};animation-duration:${(9 / speedOf(p)).toFixed(1)}s">${faces}</div></div><div class="cubeshadow loop pulse"></div><div class="heading a rise" style="${d(0.4)}">${esc(textOf(p, ctx))}</div>${S(p, 'subtitle') || ctx.subtitle ? `<div class="small a fade" style="${d(0.6)}">${esc(S(p, 'subtitle') || ctx.subtitle)}</div>` : ''}</div>`, 1100, 720, accentStyle(p)), css: `.rbx .cube3{position:relative;transform-style:preserve-3d;animation-name:rbx-cube3;animation-timing-function:linear}.rbx .cubeface{position:absolute;inset:0;border:${px(2)} solid #ffffff66;background:linear-gradient(135deg,#ffffff2a,#ffffff08),var(--card);box-shadow:inset 0 0 ${px(30)} #ffffff1a}.rbx .cubeshadow{width:${px(s * 1.1)};height:${px(30)};border-radius:50%;background:radial-gradient(ellipse,#000000aa,transparent 70%);margin-top:${px(-10)}}@keyframes rbx-cube3{from{transform:rotateX(-20deg) rotateY(0)}to{transform:rotateX(-20deg) rotateY(360deg)}}` };
    },
  }),
  bit({
    id: 'lanyard', name: 'Lanyard', category: 'component', level: 'advanced',
    about: 'A physics badge on a lanyard you can swing.',
    video: 'A strap drops from the top of the frame and a badge (name, role, brand) swings under it with decaying pendulum motion.',
    use: 'Speaker intros, event passes, "meet the host".',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT, { name: 'brand', type: 'string', about: 'Small brand line on the badge.' }], example: { text: 'Ana Kapoor', subtitle: 'Speaker', brand: 'BHIPPI CONF' }, seconds: 5, layout: 'fullscreen', tags: ['badge', 'physics'],
    build: (p, ctx) => ({ html: `<div class="x fill" style="${accentStyle(p)}"><div class="lanyard a" style="${d(0.05)}"><div class="strap"></div><div class="badge glass"><div class="kicker">${esc(S(p, 'brand', 'EVENT PASS'))}</div><div class="avatar"></div><div class="heading" style="font-size:${px(48)};margin-top:${px(18)}">${esc(textOf(p, ctx))}</div><div class="small">${esc(S(p, 'subtitle') || ctx.subtitle || 'Guest')}</div></div></div></div>`, css: `.rbx .lanyard{position:absolute;left:50%;top:0;width:0;height:0;transform-origin:0 0;animation-name:rbx-swing;animation-duration:3.2s;animation-timing-function:ease-in-out}.rbx .strap{position:absolute;left:${px(-22)};top:${px(-40)};width:${px(44)};height:${px(430)};background:repeating-linear-gradient(180deg,var(--accent) 0,var(--accent) ${px(40)},var(--accent2) ${px(40)},var(--accent2) ${px(50)})}.rbx .badge{position:absolute;left:${px(-200)};top:${px(380)};width:${px(400)};padding:${px(34)} ${px(36)};text-align:center}.rbx .avatar{width:${px(120)};height:${px(120)};border-radius:50%;margin:${px(18)} auto 0;background:linear-gradient(135deg,var(--accent2),var(--accent));box-shadow:0 ${px(8)} ${px(24)} #0006}@keyframes rbx-swing{0%{transform:translateY(-110%) rotate(-14deg)}18%{transform:translateY(0) rotate(-14deg)}40%{transform:rotate(11deg)}60%{transform:rotate(-7deg)}78%{transform:rotate(4deg)}90%{transform:rotate(-2deg)}100%{transform:rotate(0)}}` }),
  }),
  bit({
    id: 'profile-card', name: 'Profile Card', category: 'component', level: 'basic',
    about: 'A holographic profile card with avatar, name, handle and status.',
    video: 'The card pops in with a soft tilt loop; avatar (initials), name, role, a status pill and a "contact" button.',
    use: 'Creator intros, guest cards, about-me beats.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT, { name: 'handle', type: 'string', about: '@handle line.' }, { name: 'status', type: 'string', default: 'Online', about: 'Status pill text.' }], example: { text: 'Ana Kapoor', subtitle: 'Motion designer', handle: '@anak', status: 'Online' }, seconds: 5, tags: ['card', 'profile'],
    build: (p, ctx) => {
      const name = textOf(p, ctx);
      const initials = name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
      return { html: scene(`<div class="fill center" style="perspective:${px(1400)}"><div class="glass a pop pcard" style="${d(0.05)}"><div class="pcglow loop shimmer"></div><div class="pavatar a pop" style="${d(0.3)}">${esc(initials)}</div><div class="heading a rise" style="font-size:${px(52)};margin-top:${px(20)};${d(0.4)}">${esc(name)}</div><div class="small a rise" style="${d(0.5)}">${esc(S(p, 'subtitle') || ctx.subtitle || '')}${S(p, 'handle') ? ` · ${esc(S(p, 'handle'))}` : ''}</div><div class="row a rise" style="gap:${px(14)};margin-top:${px(26)};justify-content:center;${d(0.65)}"><span class="pill" style="background:#1fbf75">● ${esc(S(p, 'status', 'Online'))}</span><span class="pill" style="background:#ffffff1f">Contact</span></div></div></div>`), css: `.rbx .pcard{position:relative;overflow:hidden;width:${px(520)};padding:${px(44)} ${px(40)};text-align:center;animation-name:rbx-pop,rbx-pctilt;animation-duration:.5s,5s;animation-iteration-count:1,infinite;animation-timing-function:var(--spring),ease-in-out;transform-style:preserve-3d}.rbx .pcglow{position:absolute;inset:0;background:linear-gradient(115deg,transparent 30%,var(--accent2) 50%,transparent 70%);background-size:250% 100%;opacity:.25}.rbx .pavatar{width:${px(150)};height:${px(150)};border-radius:50%;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:${px(56)};font-weight:800;color:#fff;background:linear-gradient(135deg,var(--accent2),var(--accent));box-shadow:0 ${px(10)} ${px(30)} #0007}@keyframes rbx-pctilt{0%,100%{transform:rotateY(-6deg) rotateX(3deg)}50%{transform:rotateY(6deg) rotateX(-3deg)}}` };
    },
  }),
  bit({
    id: 'dock', name: 'Dock', category: 'component', level: 'basic',
    about: 'A macOS-style dock whose icons magnify near the pointer.',
    video: 'A glass dock rises in; a magnification wave passes across the icons as a scripted cursor moves along it.',
    use: 'App menus, tool callouts, "everything in one bar".',
    props: [P_ACCENT, P_ROWS], example: { rows: ['Plan', 'Shots', 'Voice', 'Music', 'Edit', 'QA'] }, seconds: 4, layout: 'lower-third', tags: ['dock', 'icons'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['A', 'B', 'C', 'D', 'E']).slice(0, 8);
      const ptr = pointerMoment('dock', [{ x: 40, y: 160 }, { x: rows.length * 104 + 40, y: 90 }], 0.6, 1.4, false);
      return { html: `<div class="x" style="position:relative;width:${px(rows.length * 104 + 80)};height:${px(200)};${accentStyle(p)}"><div class="glass a slide-u dock" style="${d(0.05)}">${rows.map((r, i) => `<div class="dockicon a" style="${d(0.65 + i * 0.16)};filter:hue-rotate(${i * 40}deg)"><span>${esc(r.slice(0, 2))}</span><i>${esc(r)}</i></div>`).join('')}</div>${ptr.html}</div>`, css: `${ptr.css}.rbx .dock{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:flex-end;justify-content:center;gap:${px(14)};padding:${px(14)} ${px(20)};border-radius:${px(28)}}.rbx .dockicon{position:relative;width:${px(90)};height:${px(90)};border-radius:${px(22)};background:linear-gradient(135deg,var(--accent2),var(--accent));display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${px(30)};color:#fff;transform-origin:50% 100%;animation-name:rbx-dockmag;animation-duration:.5s;animation-timing-function:ease-in-out;box-shadow:0 ${px(8)} ${px(20)} #0006}.rbx .dockicon>i{position:absolute;top:${px(-46)};font-style:normal;font-size:${px(20)};color:var(--fg);opacity:0;animation:inherit;animation-name:rbx-docklabel;white-space:nowrap}@keyframes rbx-dockmag{0%,100%{transform:scale(1)}50%{transform:scale(1.45) translateY(${px(-12)})}}@keyframes rbx-docklabel{0%,100%{opacity:0}50%{opacity:1}}` };
    },
  }),
  bit({
    id: 'gooey-nav', name: 'Gooey Nav', category: 'component', level: 'intermediate',
    about: 'Navigation where a gooey blob morphs to the active item with particles.',
    video: 'A pill nav; the active blob stretches gooey-style between items on a schedule while small particles pop at each landing.',
    use: 'Section tabs with personality, app demos.',
    props: [P_ACCENT, P_ROWS, P_SLICE], example: { rows: ['Home', 'About', 'Work', 'Contact'] }, seconds: 5, layout: 'top-left', tags: ['nav', 'goo'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three', 'Four']).slice(0, 6);
      const slice = Math.max(0.5, N(p, 'slice', 1));
      const w = 100 / rows.length;
      const frames = rows.map((_, i) => `${Math.round((i / rows.length) * 100)}%{left:${(i * w).toFixed(2)}%;width:${w.toFixed(2)}%}${Math.round(((i + 0.5) / rows.length) * 100)}%{left:${(i * w).toFixed(2)}%;width:${Math.min(100 - i * w, w * 1.9).toFixed(2)}%}${Math.round(((i + 0.85) / rows.length) * 100)}%{left:${(Math.min(rows.length - 1, i + 1) * w).toFixed(2)}%;width:${w.toFixed(2)}%}`).join('');
      return { html: `<div class="x gnav a drop" style="${d(0.05)};width:${px(Math.max(600, rows.length * 200))}"><div class="gblob a" style="${d(0.5)};animation-duration:${(slice * rows.length).toFixed(2)}s"></div>${rows.map((r) => `<div class="body gitem" style="width:${w.toFixed(2)}%">${esc(r)}</div>`).join('')}</div>`, css: `.rbx .gnav{position:relative;display:flex;padding:${px(8)};border-radius:999px;background:var(--card);border:1px solid var(--line)}.rbx .gitem{position:relative;z-index:1;text-align:center;padding:${px(18)} 0;font-weight:600}.rbx .gblob{position:absolute;top:${px(8)};bottom:${px(8)};border-radius:999px;background:var(--accent);filter:blur(${px(1)});animation-name:rbx-gblob;animation-timing-function:var(--spring)}@keyframes rbx-gblob{${frames}100%{left:${((rows.length - 1) * w).toFixed(2)}%;width:${w.toFixed(2)}%}}` };
    },
  }),
  bit({
    id: 'pixel-card', name: 'Pixel Card', category: 'component', level: 'intermediate',
    about: 'A card whose background twinkles with animated pixels.',
    video: 'A card with a seeded grid of accent pixels that twinkle on a loop behind the copy.',
    use: 'Gaming, retro branding, arcade moments.',
    props: [...CARD_PROPS, P_SPEED], example: { text: 'Pixel Card', kicker: 'RETRO' }, seconds: 5, tags: ['pixels', 'card', 'loop'],
    build: (p, ctx) => {
      const rand = rng(hash(textOf(p, ctx)));
      const pixels = Array.from({ length: 140 }, () => `<i class="pxl loop" style="left:${(rand() * 100).toFixed(1)}%;top:${(rand() * 100).toFixed(1)}%;${d(rand() * 2)};animation-duration:${((0.8 + rand() * 1.6) / speedOf(p)).toFixed(2)}s"></i>`).join('');
      return { html: scene(`<div class="fill center"><div class="a pop pxcard" style="${d(0.05)}"><div class="fill" style="overflow:hidden;border-radius:inherit">${pixels}</div>${card(p, ctx, '', 'position:relative;border:0;background:transparent;box-shadow:none')}</div></div>`), css: `.rbx .pxcard{position:relative;border-radius:${px(24)};border:${px(2)} solid var(--line);background:var(--card);box-shadow:0 ${px(20)} ${px(60)} #00000066}.rbx .pxl{position:absolute;width:${px(10)};height:${px(10)};background:var(--accent);opacity:0;animation-name:rbx-twinkle;animation-timing-function:steps(2,end)}@keyframes rbx-twinkle{0%,100%{opacity:0}50%{opacity:.9}}` };
    },
  }),
  bit({
    id: 'carousel', name: 'Carousel', category: 'component', level: 'basic',
    about: 'A card carousel with indicators.',
    video: 'Cards slide through the frame one per window with dots that follow; the last card holds.',
    use: 'Highlights, portfolios, three-point summaries.',
    props: [P_ACCENT, P_ROWS, P_SLICE], example: { rows: ['Plan — one promise', 'Gather — every shot', 'Edit — on the beat'] }, seconds: 6, tags: ['carousel'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One — a', 'Two — b', 'Three — c']).slice(0, 6);
      const slice = Math.max(0.6, N(p, 'slice', 1.5));
      const cards = rows.map((r, i) => { const { head, rest } = splitRow(r); return `<div class="glass a carcard ${i === rows.length - 1 ? '' : 'hold'}" style="${d(0.2 + i * slice)};animation-duration:${slice.toFixed(2)}s">${tile(head, i, `width:100%;height:${px(240)}`)}<div class="heading" style="font-size:${px(44)};margin-top:${px(22)}">${esc(head)}</div>${rest ? `<div class="small" style="margin-top:${px(6)}">${esc(rest)}</div>` : ''}</div>`; }).join('');
      const dots = rows.map((_, i) => `<i class="cardot a ${i === rows.length - 1 ? '' : 'hold'}" style="${d(0.2 + i * slice)};animation-duration:${slice.toFixed(2)}s"></i>`).join('');
      return { html: scene(`<div class="fill center">${cards}</div><div class="cardots">${dots}</div>`, 1100, 640, accentStyle(p)), css: `.rbx .carcard{position:absolute;width:${px(680)};padding:${px(28)};opacity:0;animation-name:rbx-carcard;animation-timing-function:var(--eo)}.rbx .cardots{position:absolute;left:0;right:0;bottom:${px(10)};display:flex;justify-content:center;gap:${px(12)}}.rbx .cardot{width:${px(14)};height:${px(14)};border-radius:50%;background:var(--line);animation-name:rbx-cardot;animation-timing-function:linear}@keyframes rbx-carcard{0%{opacity:0;transform:translateX(60%)}12%{opacity:1;transform:none}88%{opacity:1;transform:none}100%{opacity:0;transform:translateX(-60%)}}@keyframes rbx-cardot{0%,100%{background:var(--line)}5%,95%{background:var(--accent)}}` };
    },
  }),
  bit({
    id: 'spotlight-card', name: 'Spotlight Card', category: 'component', level: 'basic',
    about: 'A card with a radial spotlight that follows the pointer.',
    video: 'The card rises in; a radial light follows the scripted cursor across it and rests behind the heading.',
    use: 'Testimonials, quotes, features with one light.',
    props: CARD_PROPS, example: { text: 'Spotlight Card', subtitle: 'The light follows the hand' }, seconds: 4, tags: ['card', 'spotlight'],
    build: (p, ctx) => {
      const ptr = pointerMoment('spot', [{ x: 120, y: 540 }, { x: 420, y: 250 }, { x: 700, y: 330 }], 0.4, 1.5, false);
      return { html: scene(`<div class="fill center"><div class="a rise spotwrap" style="${d(0.05)}"><div class="spotlight a" style="${d(0.4)};animation-name:rbx-ptr-spot;animation-duration:1.5s"></div>${card(p, ctx, '', 'position:relative;background:transparent;border:0;box-shadow:none')}</div></div>${ptr.html}`), css: `${ptr.css}.rbx .spotwrap{position:relative;overflow:hidden;border-radius:${px(24)};border:${px(2)} solid var(--line);background:var(--card);box-shadow:0 ${px(20)} ${px(60)} #00000066}.rbx .spotlight{position:absolute;left:${px(-420)};top:${px(-420)};width:${px(600)};height:${px(600)};border-radius:50%;background:radial-gradient(circle,#ffffff2e 0%,transparent 60%);animation-timing-function:var(--ei)}` };
    },
  }),
  bit({
    id: 'border-glow', name: 'Border Glow', category: 'component', level: 'basic',
    about: 'A border glow that follows the pointer around the card.',
    video: 'A conic glow behind a masked border sweeps around the card once as the scripted cursor circles it, then rests at the top.',
    use: 'Featured cards, hover states in demos, "this one".',
    props: CARD_PROPS, example: { text: 'Border Glow', kicker: 'FEATURED' }, seconds: 4, tags: ['border', 'glow'],
    build: (p, ctx) => ({ html: scene(`<div class="fill center"><div class="a pop bgwrap" style="${d(0.05)}"><div class="bgconic a" style="${d(0.5)}"></div>${card(p, ctx, 'bginner')}</div></div>`), css: `.rbx .bgwrap{position:relative;padding:${px(3)};border-radius:${px(27)};overflow:hidden}.rbx .bgconic{position:absolute;left:50%;top:50%;width:${px(1600)};height:${px(1600)};margin:${px(-800)} 0 0 ${px(-800)};background:conic-gradient(from 0deg,transparent 0 70%,var(--accent) 82%,var(--accent2) 88%,transparent 100%);animation-name:rbx-spin;animation-duration:2s;animation-timing-function:var(--ei)}.rbx .bginner{position:relative;z-index:1}` }),
  }),
  bit({
    id: 'flying-posters', name: 'Flying Posters', category: 'component', level: 'advanced',
    about: 'Posters fly in from depth and stack into a wall.',
    video: 'Eight labelled posters swoop in from far away with rotation and land in a fanned wall; the heading settles in front.',
    use: 'Events, lineups, recaps, "everything we did this year".',
    props: [P_TEXT, P_ACCENT, P_ROWS], example: { text: '2026 recap', rows: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'] }, seconds: 5, layout: 'fullscreen', tags: ['posters', '3d'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['01', '02', '03', '04', '05', '06', '07', '08']);
      const rand = rng(hash(textOf(p, ctx)));
      const posters = Array.from({ length: 8 }, (_, i) => `<div class="a poster" style="--fx:${px(-640 + (i % 4) * 420 + (rand() - 0.5) * 60)};--fy:${px((i < 4 ? -170 : 190) + (rand() - 0.5) * 60)};--rot:${((rand() - 0.5) * 18).toFixed(1)}deg;${d(0.1 + i * 0.12)}">${tile(rows[i % rows.length], i, `width:${px(320)};height:${px(420)}`)}</div>`).join('');
      return { html: `<div class="x fill" style="${accentStyle(p)}"><div class="fill center" style="perspective:${px(1400)}">${posters}</div><div class="fill center hero a pop" style="${d(1.4)}"><span class="pill" style="font-size:${px(56)};padding:${px(18)} ${px(50)}">${esc(textOf(p, ctx))}</span></div></div>`, css: '.rbx .poster{position:absolute;animation-name:rbx-poster;animation-duration:1.1s;animation-timing-function:var(--eo)}@keyframes rbx-poster{from{opacity:0;transform:translate3d(0,0,calc(-2400px * var(--u))) rotateY(60deg)}to{opacity:1;transform:translate3d(var(--fx),var(--fy),0) rotate(var(--rot))}}' };
    },
  }),
  bit({
    id: 'card-swap', name: 'Card Swap', category: 'component', level: 'intermediate',
    about: 'Stacked cards periodically swap places with a spring.',
    video: 'Three offset cards; on each window the front card drops back and the next comes forward with a spring.',
    use: 'Comparisons, "three ways", feature rotation.',
    props: [P_ACCENT, P_ROWS, P_SLICE], example: { rows: ['Reliable — it just works', 'Smooth — buttery motion', 'Customizable — your look'] }, seconds: 6, tags: ['cards', 'swap'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One — a', 'Two — b', 'Three — c']).slice(0, 3);
      const slice = Math.max(0.8, N(p, 'slice', 1.6));
      const n = rows.length;
      const cards = rows.map((r, i) => { const { head, rest } = splitRow(r); return `<div class="glass a swapcard" style="${d(0.4 + i * 0)};animation-name:rbx-swap${n}-${i};animation-duration:${(slice * n).toFixed(2)}s"><div class="kicker">0${i + 1}</div><div class="heading" style="font-size:${px(50)};margin-top:${px(8)}">${esc(head)}</div>${rest ? `<div class="small" style="margin-top:${px(10)}">${esc(rest)}</div>` : ''}</div>`; }).join('');
      const pos = (k: number) => `transform:translate(${px(k * 60)},${px(k * -40)}) scale(${(1 - k * 0.06).toFixed(2)});z-index:${10 - k};opacity:${(1 - k * 0.25).toFixed(2)}`;
      const kf = rows.map((_, i) => { const stops: string[] = []; for (let s = 0; s <= n; s++) { const k = (i - s + n * 2) % n; const pct = (s / n) * 100; if (s < n) stops.push(`${pct.toFixed(2)}%,${(pct + 100 / n - 12).toFixed(2)}%{${pos(k)}}`); else stops.push(`100%{${pos((i - n + n * 2) % n)}}`); } return `@keyframes rbx-swap${n}-${i}{${stops.join('')}}`; }).join('');
      return { html: scene(`<div class="fill center a pop" style="${d(0.05)}">${cards}</div>`, 1100, 620, accentStyle(p)), css: `.rbx .swapcard{position:absolute;width:${px(640)};padding:${px(40)} ${px(48)};animation-timing-function:var(--spring);animation-fill-mode:forwards}${kf}` };
    },
  }),
  bit({
    id: 'glass-icons', name: 'Glass Icons', category: 'component', level: 'basic',
    about: 'Frosted glass icon chips with coloured backs that lift on hover.',
    video: 'Glass chips (rows) float in with a stagger over tinted plates, each lifting briefly in turn.',
    use: 'App promos, social rows, tool stacks.',
    props: [P_ACCENT, P_ROWS], example: { rows: ['Files', 'Books', 'Health', 'Weather', 'Music', 'Maps'] }, seconds: 5, tags: ['icons', 'glass'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['A', 'B', 'C', 'D', 'E', 'F']).slice(0, 8);
      return { html: scene(`<div class="fill center" style="gap:${px(40)};flex-wrap:wrap;padding:${px(40)}">${rows.map((r, i) => `<div class="col a pop" style="align-items:center;gap:${px(14)};${d(0.1 + i * 0.1)}"><div class="gichip loop float" style="${d(i * 0.3)};animation-duration:3s"><i class="giback" style="filter:hue-rotate(${i * 50}deg)"></i><span class="heading" style="font-size:${px(40)}">${esc(r.slice(0, 1))}</span></div><div class="small">${esc(r)}</div></div>`).join('')}</div>`, 1100, 620, accentStyle(p)), css: `.rbx .gichip{position:relative;width:${px(150)};height:${px(150)};display:flex;align-items:center;justify-content:center;border-radius:${px(34)};background:linear-gradient(135deg,#ffffff33,#ffffff0d);border:${px(2)} solid #ffffff55;box-shadow:inset 0 1px 0 #fff8,0 ${px(14)} ${px(34)} #0006}.rbx .giback{position:absolute;inset:${px(10)};border-radius:${px(28)};background:linear-gradient(135deg,var(--accent2),var(--accent));transform:rotate(-10deg) translate(${px(-10)},${px(10)});z-index:-1;opacity:.9}` };
    },
  }),
  bit({
    id: 'decay-card', name: 'Decay Card', category: 'component', level: 'intermediate',
    about: 'An image card that distorts and decays as it moves.',
    video: 'A tall tile card enters, then its surface wobbles with blur, contrast and a skew tremor before it heals still.',
    use: 'Editorial, fashion, glitch-art, memory metaphors.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT], example: { text: 'The Dream', subtitle: 'Decay Card' }, seconds: 5, tags: ['card', 'distort'],
    build: (p, ctx) => ({ html: scene(`<div class="fill center"><div class="a rise" style="${d(0.05)}"><div class="decaywrap a" style="${d(0.7)}">${tile('', 0, `width:${px(360)};height:${px(500)}`)}<div class="decaylabel"><div class="heading" style="font-size:${px(44)}">${esc(textOf(p, ctx))}</div><div class="small">${esc(S(p, 'subtitle') || ctx.subtitle || '')}</div></div></div></div></div>`, 1100, 620, accentStyle(p)), css: `.rbx .decaywrap{position:relative;animation-name:rbx-decay;animation-duration:1.8s;animation-timing-function:ease-in-out}.rbx .decaylabel{position:absolute;left:${px(24)};bottom:${px(24)}}@keyframes rbx-decay{0%,100%{filter:none;transform:none}20%{filter:blur(${px(3)}) contrast(1.4);transform:skewX(-6deg) scaleY(1.04)}45%{filter:blur(${px(6)}) contrast(1.8) saturate(1.4);transform:skewX(8deg) translateX(${px(10)})}70%{filter:blur(${px(2)}) contrast(1.2);transform:skewX(-3deg)}}` }),
  }),
  bit({
    id: 'flowing-menu', name: 'Flowing Menu', category: 'component', level: 'basic',
    about: 'Menu rows that reveal a flowing marquee band on hover.',
    video: 'Full-width rows pour in; on a schedule each row flips to its accent band with a marquee of its label, then flips back; the last stays.',
    use: 'Menus, chapters, credits, "pick a section".',
    props: [P_ACCENT, P_ROWS, P_SLICE], example: { rows: ['Mojave', 'Sonoma', 'Monterey', 'Sequoia'] }, seconds: 6, layout: 'fullscreen', tags: ['menu', 'marquee'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three', 'Four']).slice(0, 6);
      const slice = Math.max(0.5, N(p, 'slice', 1));
      return { html: `<div class="x fill col" style="justify-content:center;${accentStyle(p)}">${rows.map((r, i) => `<div class="fmrow a rise" style="${d(0.1 + i * 0.09)}"><span class="hero" style="font-size:${px(88)}">${esc(r)}</span><div class="fmband a ${i === rows.length - 1 ? '' : 'hold'}" style="${d(0.8 + i * slice)};animation-duration:${slice.toFixed(2)}s"><div class="loop marquee" style="display:inline-flex;animation-duration:6s">${`<span class="hero" style="font-size:${px(88)};color:#fff;padding:0 ${px(40)}">${esc(r)} ✦</span>`.repeat(6)}</div></div></div>`).join('')}</div>`, css: `.rbx .fmrow{position:relative;overflow:hidden;padding:${px(18)} ${px(120)};border-top:1px solid var(--line)}.rbx .fmband{position:absolute;inset:0;background:var(--accent);white-space:nowrap;display:flex;align-items:center;transform:translateY(100%);animation-name:rbx-fmband;animation-timing-function:var(--eo)}@keyframes rbx-fmband{0%{transform:translateY(100%)}15%{transform:translateY(0)}85%{transform:translateY(0)}100%{transform:translateY(-100%)}}` };
    },
  }),
  bit({
    id: 'elastic-slider', name: 'Elastic Slider', category: 'component', level: 'basic',
    about: 'A slider whose track stretches elastically when dragged past its ends.',
    video: 'A scripted drag runs the thumb to the right end and past it: the track stretches, then snaps back with a spring.',
    use: 'Volume/brightness demos, playful controls.',
    props: [P_TEXT, P_ACCENT], example: { text: 'Volume' }, seconds: 4, tags: ['slider', 'spring'],
    build: (p, ctx) => {
      const ptr = pointerMoment('eslider', [{ x: 260, y: 330 }, { x: 900, y: 330 }, { x: 980, y: 330 }, { x: 900, y: 330 }], 0.5, 1.8, false);
      return { html: scene(`<div class="heading a rise" style="position:absolute;left:${px(250)};top:${px(200)};${d(0.05)}">${esc(textOf(p, ctx))}</div><div class="etrack a fade estretch" style="${d(0.1)};animation-name:rbx-fade,rbx-estretch;animation-duration:.4s,1.8s;animation-delay:calc(var(--t) + var(--at,0s)),calc(var(--t) + var(--at,0s) + .5s)"><div class="efill a" style="${d(0.5)}"></div></div>${ptr.html}`), css: `${ptr.css}.rbx .etrack{position:absolute;left:${px(250)};width:${px(640)};top:${px(316)};height:${px(28)};border-radius:999px;background:#ffffff1a;transform-origin:0 50%;animation-timing-function:var(--spring)}.rbx .efill{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:var(--accent);animation-name:rbx-efill;animation-duration:1.8s;animation-timing-function:var(--ei)}@keyframes rbx-estretch{0%,40%{transform:scaleX(1)}66%{transform:scaleX(1.12) scaleY(.8)}100%{transform:scaleX(1)}}@keyframes rbx-efill{0%{width:2%}66%{width:100%}100%{width:100%}}` };
    },
  }),
  bit({
    id: 'counter', name: 'Counter', category: 'component', level: 'basic',
    about: 'An odometer-style counter with rolling digits and +/− controls.',
    video: 'Boxed digit reels roll to the value with ease-out; a scripted cursor taps "+" at the end for one more tick.',
    use: 'Scores, member counts, "and counting".',
    props: [P_ACCENT, { name: 'value', type: 'number', default: 1024, about: 'The number shown after the roll (real numbers only).' }, { name: 'label', type: 'string', about: 'Line under the counter.' }], example: { value: 1024, label: 'subscribers' }, seconds: 4, tags: ['number', 'odometer'],
    build: (p, ctx) => {
      const value = Math.round(Math.abs(N(p, 'value', ctx.values[0] ?? 1024)));
      const digits = String(value).split('');
      const reels = digits.map((ch, i) => `<div class="reel"><div class="reelstrip a" style="--n:${ch};${d(0.2 + (digits.length - 1 - i) * 0.06)}">${'0123456789'.split('').map((n) => `<i>${n}</i>`).join('')}</div></div>`).join('');
      const ptr = pointerMoment('counter', [{ x: 200, y: 560 }, { x: 800, y: 330 }], 1.6, 0.9, true);
      return { html: scene(`<div class="fill center col" style="gap:${px(26)}"><div class="row a pop" style="gap:${px(30)};${d(0.05)}"><div class="cbtn">−</div><div class="row" style="gap:${px(10)}">${reels}</div><div class="cbtn a press" style="${d(2.5)}">+</div></div>${S(p, 'label') ? `<div class="small a rise" style="${d(0.5)}">${esc(S(p, 'label'))}</div>` : ''}</div>${ptr.html}`, 1100, 620, accentStyle(p)), css: `${ptr.css}.rbx .reel{width:${px(96)};height:${px(140)};overflow:hidden;border-radius:${px(16)};background:var(--card);border:1px solid var(--line);box-shadow:inset 0 ${px(-20)} ${px(30)} #0006}.rbx .reelstrip{display:flex;flex-direction:column;animation-name:rbx-roll;animation-duration:1.4s;animation-timing-function:var(--eo)}.rbx .reelstrip>i{display:block;height:${px(140)};line-height:${px(140)};text-align:center;font-size:${px(96)};font-weight:800;font-style:normal;font-variant-numeric:tabular-nums}.rbx .cbtn{width:${px(90)};height:${px(90)};border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:${px(56)};font-weight:700}@keyframes rbx-roll{from{transform:translateY(0)}to{transform:translateY(calc(var(--n,0) * -${px(140)}))}}` };
    },
  }),
  bit({
    id: 'infinite-menu', name: 'Infinite Menu', category: 'component', level: 'intermediate',
    about: 'Menu items on a 3D sphere you drag endlessly.',
    video: 'Items ring a 3D carousel (rotateY per item, pushed out on Z) turning on a loop; the front item is brightest.',
    use: 'Sponsors, credits, tickers, "endless options".',
    props: [P_ACCENT, P_SPEED, P_ROWS], example: { rows: ['Design', 'Motion', 'Sound', 'Edit', 'Colour', 'Ship'] }, seconds: 6, tags: ['menu', '3d', 'loop'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three', 'Four', 'Five', 'Six']);
      const n = rows.length;
      const r = Math.max(260, n * 70);
      return { html: scene(`<div class="fill center" style="perspective:${px(1400)}"><div class="imring loop" style="animation-duration:${(16 / speedOf(p)).toFixed(1)}s">${rows.map((row, i) => `<div class="glass imitem a fade" style="transform:rotateY(${((i * 360) / n).toFixed(1)}deg) translateZ(${px(r)});${d(0.1 + i * 0.06)}"><span class="heading" style="font-size:${px(40)}">${esc(row)}</span></div>`).join('')}</div></div>`, 1100, 620, accentStyle(p)), css: `.rbx .imring{position:relative;width:0;height:0;transform-style:preserve-3d;animation-name:rbx-imring;animation-timing-function:linear}.rbx .imitem{position:absolute;left:${px(-160)};top:${px(-50)};width:${px(320)};padding:${px(22)} 0;text-align:center;backface-visibility:hidden}@keyframes rbx-imring{from{transform:rotateX(-8deg) rotateY(0)}to{transform:rotateX(-8deg) rotateY(-360deg)}}` };
    },
  }),
  bit({
    id: 'stepper', name: 'Stepper', category: 'component', level: 'basic',
    about: 'A multi-step flow with numbered indicators and a content card.',
    video: 'Numbered dots connect with a progress line that fills step by step; the card content changes with each step; the last step holds with a check.',
    use: 'Processes, tutorials, "three steps".',
    props: [P_ACCENT, P_ROWS, P_SLICE], example: { rows: ['Plan — the promise', 'Gather — every shot', 'Edit — cut on the beat', 'Ship — export'] }, seconds: 6, tags: ['steps', 'process'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One — a', 'Two — b', 'Three — c']).slice(0, 6);
      const slice = Math.max(0.6, N(p, 'slice', 1.2));
      const n = rows.length;
      const dots = rows.map((_, i) => `<div class="stepdot a stepon" style="${d(0.3 + i * slice)}">${i === n - 1 ? '✓' : i + 1}</div>${i < n - 1 ? `<div class="stepline"><i class="a grow-x" style="${d(0.3 + i * slice + slice * 0.3)};animation-duration:${(slice * 0.6).toFixed(2)}s"></i></div>` : ''}`).join('');
      const cards = rows.map((r, i) => { const { head, rest } = splitRow(r); return `<div class="glass a stepcard ${i === n - 1 ? '' : 'hold'}" style="${d(0.3 + i * slice)};animation-duration:${slice.toFixed(2)}s"><div class="kicker">STEP ${i + 1} OF ${n}</div><div class="heading" style="font-size:${px(50)};margin-top:${px(8)}">${esc(head)}</div>${rest ? `<div class="small" style="margin-top:${px(8)}">${esc(rest)}</div>` : ''}</div>`; }).join('');
      return { html: scene(`<div class="row a fade" style="position:absolute;left:${px(120)};right:${px(120)};top:${px(80)};${d(0.05)}">${dots}</div><div class="fill" style="top:${px(200)}">${cards}</div>`, 1100, 620, accentStyle(p)), css: `.rbx .stepdot{width:${px(70)};height:${px(70)};border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${px(30)};background:var(--card);border:${px(2)} solid var(--line);color:var(--muted)}.rbx .stepon{animation-name:rbx-stepon;animation-duration:.4s}.rbx .stepline{flex:1;height:${px(4)};background:var(--line);margin:0 ${px(10)}}.rbx .stepline>i{display:block;height:100%;background:var(--accent);transform-origin:left}.rbx .stepcard{position:absolute;left:${px(120)};right:${px(120)};top:0;padding:${px(40)} ${px(48)};opacity:0;animation-name:rbx-window;animation-timing-function:var(--eo)}@keyframes rbx-stepon{to{background:var(--accent);border-color:var(--accent);color:#fff}}` };
    },
  }),
  bit({
    id: 'bounce-cards', name: 'Bounce Cards', category: 'component', level: 'basic',
    about: 'Cards bounce in and fan out with a spring.',
    video: 'Five tiles drop into a fanned row with a spring, each rotated slightly, then the heading appears.',
    use: 'Photo dumps, "highlights", playful intros.',
    props: [P_TEXT, P_ACCENT, P_ROWS], example: { text: 'Highlights', rows: ['01', '02', '03', '04', '05'] }, seconds: 4, tags: ['cards', 'spring'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['01', '02', '03', '04', '05']).slice(0, 7);
      const mid = (rows.length - 1) / 2;
      return { html: scene(`<div class="fill center">${rows.map((r, i) => `<div class="a bcard" style="--tx:${px((i - mid) * 180)};--rot:${((i - mid) * 7).toFixed(1)}deg;z-index:${i};${d(0.1 + i * 0.1)}">${tile(r, i, `width:${px(260)};height:${px(340)}`)}</div>`).join('')}</div><div class="heading a rise" style="position:absolute;left:0;right:0;bottom:${px(20)};text-align:center;${d(1.1)}">${esc(textOf(p, ctx))}</div>`, 1200, 620, accentStyle(p)), css: '.rbx .bcard{position:absolute;animation-name:rbx-bcard;animation-duration:.9s;animation-timing-function:var(--spring)}@keyframes rbx-bcard{from{opacity:0;transform:translate(0,calc(-400px * var(--u))) rotate(0) scale(.6)}to{opacity:1;transform:translate(var(--tx),0) rotate(var(--rot)) scale(1)}}' };
    },
  }),
];
