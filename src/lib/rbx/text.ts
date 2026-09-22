// React Bits — Text Animations (32), rebuilt as scrub-safe CSS choreography.
//
// Every bit here shows copy arriving: per-letter or per-word paused entrances, glyph stacks for the
// cipher effects, digit columns for counters, gradient-clipped type for sheens. All of them accept
// `text`, `size`, `align`, `accent`; the id list mirrors reactbits.dev's Text Animations section.

import {
  ASCII, B, CIPHER, GLYPHS, N, P_ACCENT, P_ALIGN, P_ROWS, P_SIZE, P_SPEED, P_STAGGER, P_SUBTITLE, P_TEXT, S,
  accentStyle, alignOf, bit, d, esc, glyphStack, hash, letters, px, rng, rowsOf, sizeClass, speedOf, svg, textOf, unitCount, wordsOf,
  type Bit, type BitContext, type BitProps,
} from './core';

const block = (p: BitProps, inner: string, cls = '', style = ''): string =>
  `<div class="x tb ${sizeClass(p)} ${cls}" style="text-align:${alignOf(p)};${accentStyle(p)}${style}">${inner}</div>`;

const sub = (p: BitProps, ctx: BitContext, from: number): string => {
  const line = S(p, 'subtitle') || ctx.subtitle;
  return line ? `<div class="small a rise" style="margin-top:${px(24)};${d(from)}">${esc(line)}</div>` : '';
};

const T = [P_TEXT, P_SIZE, P_ALIGN, P_ACCENT];

export const TEXT_BITS: Bit[] = [
  bit({
    id: 'split-text', name: 'Split Text', category: 'text', level: 'basic',
    about: 'Splits a string into characters or words and animates each into place with a stagger.',
    video: 'Per-unit paused entrances (rise + blur) staggered along the copy; the letters stay intact.',
    use: 'Headlines that assemble on a beat; hooks; channel names.',
    props: [...T, P_SUBTITLE, { name: 'unit', type: 'enum', values: ['letter', 'word'], default: 'letter', about: 'What animates separately.' }, { ...P_STAGGER, default: 0.03 }],
    example: { text: 'Motion is not difficult', unit: 'letter' }, seconds: 4, tags: ['headline', 'hook'], textStyle: 'rb-split',
    build: (p, ctx) => {
      const unit = S(p, 'unit', 'letter');
      const step = N(p, 'stagger', unit === 'letter' ? 0.03 : 0.1);
      const t = textOf(p, ctx);
      return { html: block(p, (unit === 'letter' ? letters(t, { step }) : wordsOf(t, { step })) + sub(p, ctx, 0.3 + step * unitCount(t))) };
    },
  }),
  bit({
    id: 'blur-text', name: 'Blur Text', category: 'text', level: 'basic',
    about: 'Words resolve out of a blur into focus, one after another.',
    video: 'Word-by-word paused blur-in, 0.7 s each, staggered.',
    use: 'Soft reveals over busy footage; intros; quotes.',
    props: [...T, P_SUBTITLE, { ...P_STAGGER, default: 0.12 }], example: { text: 'Isn\'t this so cool?!' }, seconds: 4, tags: ['soft', 'quote'], textStyle: 'rb-blur',
    build: (p, ctx) => {
      const t = textOf(p, ctx);
      const step = N(p, 'stagger', 0.12);
      return { html: block(p, wordsOf(t, { step, cls: 'w a blur-in' }) + sub(p, ctx, 0.5 + step * t.split(/\s+/).length)) };
    },
  }),
  bit({
    id: 'circular-text', name: 'Circular Text', category: 'text', level: 'intermediate',
    about: 'Letters set on a ring that rotates continuously.',
    video: 'Each letter is placed on the circle with a transform; the ring is a paused infinite spin scrubbed by time; an optional centre word pops in.',
    use: 'Badges, stamps, logos, channel idents, "since 2019" rings.',
    props: [P_TEXT, P_ACCENT, P_SPEED, { name: 'radius', type: 'number', default: 260, about: 'Ring radius in design pixels.' }, { name: 'center', type: 'string', about: 'A word in the middle of the ring.' }, { name: 'fontSize', type: 'number', default: 44, about: 'Letter size in design pixels.' }],
    example: { text: 'REACT BITS • REACT BITS', radius: 260, center: '✦' }, seconds: 5, tags: ['badge', 'logo', 'loop'], textStyle: 'rb-circular',
    build: (p, ctx) => {
      const raw = textOf(p, ctx).toUpperCase();
      const t = raw.endsWith(' ') ? raw : `${raw} • `;
      const chars = Array.from(t);
      const radius = N(p, 'radius', 260);
      const n = chars.length;
      const ring = chars.map((ch, i) => `<span class="ch a fade" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(${((i * 360) / n).toFixed(2)}deg) translateY(${px(-radius)});${d(0.15 + i * 0.03)}">${esc(ch)}</span>`).join('');
      const centre = S(p, 'center') ? `<div class="fill center heading a pop" style="${d(0.7)}">${esc(S(p, 'center'))}</div>` : '';
      const size = radius * 2 + 140;
      return { html: `<div class="x" style="position:relative;width:${px(size)};height:${px(size)};${accentStyle(p)}"><div class="fill loop spin" style="animation-duration:${(18 / speedOf(p)).toFixed(1)}s;font-size:${px(N(p, 'fontSize', 44))};font-weight:700;letter-spacing:.1em">${ring}</div>${centre}</div>` };
    },
  }),
  bit({
    id: 'text-type', name: 'Text Type', category: 'text', level: 'basic',
    about: 'Typewriter reveal with a blinking caret.',
    video: 'Each character snaps on at its moment (steps), carrying the caret as a border while it is the newest letter; a blinking caret holds at the end.',
    use: 'Tutorials, terminals, quotes being written, code walkthroughs.',
    props: [...T, { name: 'cps', type: 'number', default: 18, about: 'Characters per second.' }, { name: 'mono', type: 'boolean', default: true, about: 'Monospace face.' }],
    example: { text: 'npm i react-bits', cps: 16 }, seconds: 4, tags: ['typewriter', 'code'], textStyle: 'rb-type',
    build: (p, ctx) => {
      const t = textOf(p, ctx);
      const step = 1 / Math.max(2, N(p, 'cps', 18));
      const total = 0.2 + unitCount(t) * step;
      const chars = letters(t, { from: 0.2, step, cls: 'ch a type-ch', style: () => `--slice:${step.toFixed(3)}s` });
      const caret = `<span class="a fade" style="${d(total)}"><span class="loop blink" style="color:var(--accent)">▍</span></span>`;
      return {
        html: block(p, `<span class="${B(p, 'mono', true) ? 'mono' : ''}" style="font-weight:600">${chars}${caret}</span>`),
        css: '.rbx .type-ch{animation-name:rbx-type;animation-duration:var(--slice);animation-timing-function:linear;border-right:.06em solid transparent}@keyframes rbx-type{0%{opacity:0;border-right-color:var(--accent)}1%{opacity:1;border-right-color:var(--accent)}99%{opacity:1;border-right-color:var(--accent)}100%{opacity:1;border-right-color:transparent}}',
      };
    },
  }),
  bit({
    id: 'shuffle', name: 'Shuffle', category: 'text', level: 'intermediate',
    about: 'Letters shuffle through neighbours before settling on the word.',
    video: 'A seeded glyph stack per letter drawn from the word\'s own letters, four slices each, then the real letter fades in.',
    use: 'Playful reveals, challenge titles, quiz answers.',
    props: [...T, { ...P_STAGGER, default: 0.04 }], example: { text: 'Shuffle the deck' }, seconds: 4, tags: ['playful', 'reveal'], textStyle: 'rb-shuffle',
    build: (p, ctx) => {
      const t = textOf(p, ctx);
      const pool = Array.from(new Set(Array.from(t.replace(/\s/g, '').toUpperCase()))).join('') || GLYPHS;
      return { html: block(p, glyphStack(t, { step: N(p, 'stagger', 0.04), cycles: 4, slice: 0.07, pool, seed: hash(t) })) };
    },
  }),
  bit({
    id: 'shiny-text', name: 'Shiny Text', category: 'text', level: 'basic',
    about: 'A specular sheen sweeps across the text on a loop.',
    video: 'Gradient-clipped type with a moving highlight band (paused loop), after a rise entrance.',
    use: 'Premium titles, prices, brand names, CTAs.',
    props: [...T, P_SPEED], example: { text: 'Just some shiny text!' }, seconds: 4, tags: ['premium', 'loop'], textStyle: 'rb-shiny',
    build: (p, ctx) => ({
      html: block(p, `<div class="a rise" style="${d(0.05)}"><span class="shiny loop shimmer" style="animation-duration:${(2.8 / speedOf(p)).toFixed(2)}s">${esc(textOf(p, ctx))}</span></div>`),
      css: '.rbx .shiny{display:inline-block;background:linear-gradient(110deg,var(--fg) 0%,var(--fg) 42%,#ffffff 50%,var(--fg) 58%,var(--fg) 100%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}',
    }),
  }),
  bit({
    id: 'text-pressure', name: 'Text Pressure', category: 'text', level: 'intermediate',
    about: 'Variable-font type that swells in weight and width near the pointer.',
    video: 'A travelling swell: each word pulses wider and heavier in turn on a paused loop; the pointer becomes a wave moving along the line.',
    use: 'Music beats, bold statements that breathe, hype titles.',
    props: [...T, P_SPEED, { name: 'intensity', type: 'number', default: 1, about: '0.3–2: how much the words swell.' }],
    example: { text: 'Pressure' }, seconds: 4, tags: ['variable', 'loop'], textStyle: 'rb-pressure',
    build: (p, ctx) => {
      const t = textOf(p, ctx);
      const k = Math.min(2, Math.max(0.3, N(p, 'intensity', 1)));
      const words = wordsOf(t, { step: 0.16, cls: 'w loop pressure', style: () => `animation-duration:${(2 / speedOf(p)).toFixed(2)}s;--k:${k}` });
      return { html: block(p, `<div class="a rise" style="${d(0.05)}">${words}</div>`), css: '.rbx .pressure{animation-name:rbx-pressure;animation-timing-function:ease-in-out;transform-origin:50% 100%}@keyframes rbx-pressure{0%,100%{transform:scale(1);font-weight:400;letter-spacing:-.02em}50%{transform:scale(calc(1 + .09 * var(--k,1)),calc(1 + .14 * var(--k,1)));font-weight:900;letter-spacing:.01em}}' };
    },
  }),
  bit({
    id: 'curved-loop', name: 'Curved Loop', category: 'text', level: 'intermediate',
    about: 'A marquee of text riding a curved path.',
    video: 'SVG text on a wide circular arc; the arc group rotates slowly on a paused loop so the words travel along the curve.',
    use: 'Banners, tickers, marquee callouts, event names.',
    props: [P_TEXT, P_ACCENT, P_SPEED, { name: 'fontSize', type: 'number', default: 120, about: 'Glyph size in SVG units (1920-wide frame).' }, { name: 'curve', type: 'number', default: 1, about: '0.4–2: how bowed the arc is.' }],
    example: { text: 'Be ✦ Creative ✦ With ✦ React ✦ Bits' }, seconds: 6, layout: 'fullscreen', tags: ['marquee', 'banner'], textStyle: 'rb-curved-loop',
    build: (p, ctx) => {
      const t = textOf(p, ctx);
      const rep = `${t} ✦ `.repeat(8);
      const curve = Math.min(2, Math.max(0.4, N(p, 'curve', 1)));
      const r = 2000 / curve;
      const cy = 540 + r - 140 * curve;
      return {
        html: `<div class="x fill" style="${accentStyle(p)}">${svg(`<defs><path id="rbx-arc" d="M ${960 - r},${cy} A ${r},${r} 0 0 1 ${960 + r},${cy}"/></defs><g class="loop arcspin" style="transform-origin:960px ${cy}px;animation-duration:${(40 / speedOf(p)).toFixed(1)}s"><text font-size="${N(p, 'fontSize', 120)}" font-weight="700" fill="var(--fg)" letter-spacing="4"><textPath href="#rbx-arc" startOffset="-8%">${esc(rep)}</textPath></text></g>`, { aspect: 'slice' })}</div>`,
        css: '.rbx .arcspin{animation-name:rbx-arcspin;animation-timing-function:linear}@keyframes rbx-arcspin{from{transform:rotate(6deg)}to{transform:rotate(-30deg)}}',
      };
    },
  }),
  bit({
    id: 'fuzzy-text', name: 'Fuzzy Text', category: 'text', level: 'intermediate',
    about: 'Text with a horizontal scan-jitter fuzz, like a bad signal.',
    video: 'Stepped text-shadow jitter and a slight contrast filter on a paused loop after a blur-in entrance.',
    use: 'Horror, mystery, lo-fi intros, 404 pages.',
    props: [...T, P_SPEED, { name: 'intensity', type: 'number', default: 1, about: 'Jitter amount.' }], example: { text: '404' }, seconds: 4, tags: ['glitch', 'lofi'], textStyle: 'rb-fuzzy',
    build: (p, ctx) => ({
      html: block(p, `<div class="a blur-in" style="${d(0.05)}"><span class="fuzzy loop" style="animation-duration:${(0.5 / speedOf(p)).toFixed(2)}s;--k:${Math.min(2, Math.max(0.3, N(p, 'intensity', 1)))}">${esc(textOf(p, ctx))}</span></div>`),
      css: '.rbx .fuzzy{display:inline-block;animation-name:rbx-fuzz;animation-timing-function:steps(6,end);filter:contrast(1.15)}@keyframes rbx-fuzz{0%{text-shadow:calc(2px * var(--k)) 0 0 #ff3a5a99,calc(-2px * var(--k)) 0 0 #3ad0ff99}25%{text-shadow:calc(-3px * var(--k)) 1px 0 #ff3a5a99,calc(3px * var(--k)) -1px 0 #3ad0ff99}50%{text-shadow:calc(1px * var(--k)) -1px 0 #ff3a5a99,calc(-1px * var(--k)) 1px 0 #3ad0ff99}75%{text-shadow:calc(-2px * var(--k)) 0 0 #ff3a5a99,calc(2px * var(--k)) 0 0 #3ad0ff99}100%{text-shadow:calc(3px * var(--k)) 1px 0 #ff3a5a99,calc(-3px * var(--k)) -1px 0 #3ad0ff99}}',
    }),
  }),
  bit({
    id: 'gradient-text', name: 'Gradient Text', category: 'text', level: 'basic',
    about: 'Text filled with an animated colour gradient.',
    video: 'Gradient-clipped type whose background position drifts on a paused loop.',
    use: 'CTAs, channel names, anything that must glow without a hue cycle.',
    props: [...T, P_SPEED, { name: 'colors', type: 'string[]', about: 'Gradient stops (hex). Defaults to accent → accent2 → foreground.' }],
    example: { text: 'Add a splash of color!' }, seconds: 4, tags: ['gradient', 'loop'], textStyle: 'rb-gradient',
    build: (p, ctx) => {
      const colors = (Array.isArray(p.colors) ? (p.colors as unknown[]).filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) : []);
      const stops = colors.length >= 2 ? [...colors, colors[0]].join(',') : 'var(--accent),var(--accent2),var(--fg),var(--accent)';
      return {
        html: block(p, `<div class="a rise" style="${d(0.05)}"><span class="gradtext loop shimmer" style="background-image:linear-gradient(90deg,${stops});animation-duration:${(4 / speedOf(p)).toFixed(2)}s">${esc(textOf(p, ctx))}</span></div>`),
        css: '.rbx .gradtext{display:inline-block;background-size:300% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}',
      };
    },
  }),
  bit({
    id: 'falling-text', name: 'Falling Text', category: 'text', level: 'intermediate',
    about: 'Words fall from above with physics and pile up.',
    video: 'Each word drops from above with a bounce and a small seeded tilt, in order; there is no pile — words land in their reading place.',
    use: 'Countdowns, lists, lyric drops, playful hooks.',
    props: [...T, { ...P_STAGGER, default: 0.08 }], example: { text: 'React Bits is a library of animated components' }, seconds: 4, tags: ['playful', 'drop'], textStyle: 'rb-falling',
    build: (p, ctx) => {
      const t = textOf(p, ctx);
      const rand = rng(hash(t));
      return { html: block(p, wordsOf(t, { step: N(p, 'stagger', 0.08), cls: 'w a fall', style: () => `--rot:${((rand() - 0.5) * 16).toFixed(1)}deg` })), css: '.rbx .fall{animation-name:rbx-fall;animation-duration:.9s;animation-timing-function:var(--soft)}@keyframes rbx-fall{0%{opacity:0;transform:translateY(-140%) rotate(var(--rot,0deg))}55%{opacity:1;transform:translateY(7%) rotate(0)}78%{transform:translateY(-3%)}100%{transform:none}}' };
    },
  }),
  bit({
    id: 'text-cursor', name: 'Text Cursor', category: 'text', level: 'basic',
    about: 'A block cursor trails the typing reveal and blinks.',
    video: 'Typewriter reveal where the newest letter carries a solid accent block; the block keeps blinking at the end.',
    use: 'Demo captions, code walkthroughs, terminal moments.',
    props: [...T, { name: 'cps', type: 'number', default: 14, about: 'Characters per second.' }], example: { text: 'Type it out.' }, seconds: 4, tags: ['typewriter'], textStyle: 'rb-cursor',
    build: (p, ctx) => {
      const t = textOf(p, ctx);
      const step = 1 / Math.max(2, N(p, 'cps', 14));
      const total = 0.2 + unitCount(t) * step;
      return {
        html: block(p, `<span class="mono">${letters(t, { from: 0.2, step, cls: 'ch a blockch', style: () => `--slice:${step.toFixed(3)}s` })}<span class="a fade" style="${d(total)}"><span class="loop blink blockcaret">&nbsp;</span></span></span>`),
        css: '.rbx .blockch{animation-name:rbx-blockch;animation-duration:var(--slice);animation-timing-function:linear;border-radius:.06em}.rbx .blockcaret{display:inline-block;width:.6em;height:1em;vertical-align:-.12em;background:var(--accent)}@keyframes rbx-blockch{0%{opacity:0;background:var(--accent);color:transparent}1%{opacity:1;background:var(--accent);color:transparent}99%{opacity:1;background:var(--accent);color:transparent}100%{opacity:1;background:transparent;color:inherit}}',
      };
    },
  }),
  bit({
    id: 'decrypted-text', name: 'Decrypted Text', category: 'text', level: 'intermediate',
    about: 'Cipher glyphs cycle then lock into the message, character by character.',
    video: 'Seeded cipher glyph stacks (A–Z, digits, symbols) in a monospace face, resolving in reading order.',
    use: 'Tech, gaming, true-crime and hacker reveals; passwords; codenames.',
    props: [...T, { ...P_STAGGER, default: 0.045 }, { name: 'cycles', type: 'number', default: 7, about: 'Glyphs each character cycles through.' }],
    example: { text: 'ACCESS GRANTED' }, seconds: 4, tags: ['cipher', 'tech'], textStyle: 'rb-decrypted',
    build: (p, ctx) => {
      const t = textOf(p, ctx);
      return { html: block(p, `<span class="mono">${glyphStack(t, { step: N(p, 'stagger', 0.045), cycles: Math.round(Math.min(12, Math.max(2, N(p, 'cycles', 7)))), slice: 0.05, glyphs: CIPHER, seed: hash(t) })}</span>`) };
    },
  }),
  bit({
    id: 'true-focus', name: 'True Focus', category: 'text', level: 'intermediate',
    about: 'A focus frame moves word to word; the active word is sharp, the rest defocused.',
    video: 'Each word owns a time window: sharp with corner brackets during it, blurred outside; the last word stays in focus.',
    use: 'Keywords in talking-head captions; slogans read one word at a time.',
    props: [...T, { name: 'slice', type: 'number', default: 0.7, about: 'Seconds each word holds focus.' }], example: { text: 'True Focus' }, seconds: 4, tags: ['caption', 'emphasis'], textStyle: 'rb-true-focus',
    build: (p, ctx) => {
      const t = textOf(p, ctx);
      const words = t.split(/\s+/).filter(Boolean);
      const slice = Math.max(0.25, N(p, 'slice', 0.7));
      const html = words.map((w, i) => `<span class="w tf"><span class="a focus ${i === words.length - 1 ? '' : 'hold'}" style="${d(0.2 + i * slice)};animation-duration:${slice.toFixed(2)}s">${esc(w)}</span><span class="fbox a focus ${i === words.length - 1 ? '' : 'hold'}" style="${d(0.2 + i * slice)};animation-duration:${slice.toFixed(2)}s"></span></span>`).join('');
      return {
        html: block(p, html),
        css: '.rbx .tf{position:relative;padding:.05em .1em}.rbx .tf>span:first-child{display:inline-block;filter:blur(calc(6px * var(--u)));opacity:.45}.rbx .focus{animation-name:rbx-focus;animation-timing-function:ease-in-out}.rbx .fbox{position:absolute;inset:-.06em -.04em;opacity:0;filter:none;background:linear-gradient(var(--accent),var(--accent)) top left/.28em .06em no-repeat,linear-gradient(var(--accent),var(--accent)) top left/.06em .28em no-repeat,linear-gradient(var(--accent),var(--accent)) top right/.28em .06em no-repeat,linear-gradient(var(--accent),var(--accent)) top right/.06em .28em no-repeat,linear-gradient(var(--accent),var(--accent)) bottom left/.28em .06em no-repeat,linear-gradient(var(--accent),var(--accent)) bottom left/.06em .28em no-repeat,linear-gradient(var(--accent),var(--accent)) bottom right/.28em .06em no-repeat,linear-gradient(var(--accent),var(--accent)) bottom right/.06em .28em no-repeat;animation-name:rbx-fbox}@keyframes rbx-focus{0%{filter:blur(calc(6px * var(--u)));opacity:.45}18%{filter:blur(0);opacity:1}86%{filter:blur(0);opacity:1}100%{filter:blur(calc(6px * var(--u)));opacity:.45}}@keyframes rbx-fbox{0%{opacity:0}18%{opacity:1}86%{opacity:1}100%{opacity:0}}',
      };
    },
  }),
  bit({
    id: 'scroll-float', name: 'Scroll Float', category: 'text', level: 'basic',
    about: 'Characters float up from below, stretched, and settle as you scroll.',
    video: 'Per-letter paused entrance: from 120% below, scaled tall and narrow, to place; the scroll becomes the clip\'s time.',
    use: 'Travel, vlogs, lyric lines, section titles.',
    props: [...T, { ...P_STAGGER, default: 0.03 }], example: { text: 'Scroll Float' }, seconds: 4, tags: ['float'], textStyle: 'rb-scroll-float',
    build: (p, ctx) => ({ html: block(p, letters(textOf(p, ctx), { step: N(p, 'stagger', 0.03), cls: 'ch a floatin' })), css: '.rbx .floatin{animation-name:rbx-floatin;animation-duration:.9s;animation-timing-function:var(--soft);transform-origin:50% 0}@keyframes rbx-floatin{from{opacity:0;transform:translateY(120%) scale(.7,2.3)}to{opacity:1;transform:none}}' }),
  }),
  bit({
    id: 'scroll-reveal', name: 'Scroll Reveal', category: 'text', level: 'basic',
    about: 'A paragraph un-rotates and its words sharpen from a blur as it scrolls in.',
    video: 'The block eases from a 4° tilt to level while words sharpen in reading order.',
    use: 'Editorial titles, testimonials, paragraphs that must be read.',
    props: [...T, { ...P_STAGGER, default: 0.06 }], example: { text: 'When does a man die? When he is hit by a bullet? No! When he is forgotten.', size: 'heading' }, seconds: 6, tags: ['editorial'], textStyle: 'rb-scroll-reveal',
    build: (p, ctx) => ({ html: block(p, `<div class="a unrot" style="${d(0)}">${wordsOf(textOf(p, ctx), { step: N(p, 'stagger', 0.06), cls: 'w a revealw' })}</div>`, '', 'max-width:100%'), css: '.rbx .unrot{animation-name:rbx-unrot;animation-duration:1.2s;animation-timing-function:var(--eo);transform-origin:0 100%}.rbx .revealw{animation-name:rbx-revealw;animation-duration:.6s;animation-timing-function:ease-out}@keyframes rbx-unrot{from{transform:rotate(4deg)}to{transform:none}}@keyframes rbx-revealw{from{opacity:.12;filter:blur(calc(5px * var(--u)))}to{opacity:1;filter:blur(0)}}' }),
  }),
  bit({
    id: 'ascii-text', name: 'ASCII Text', category: 'text', level: 'advanced',
    about: '3D text rendered as ASCII characters that ripple.',
    video: 'Monospace glyph stacks drawn from the ASCII density ramp resolve into the copy under faint scanlines; a slow shimmer keeps the surface alive.',
    use: 'Hacker aesthetic, retro gaming, terminal intros.',
    props: [...T, { ...P_STAGGER, default: 0.03 }], example: { text: 'ASCII', size: 'display' }, seconds: 4, tags: ['retro', 'terminal'], textStyle: 'rb-ascii',
    build: (p, ctx) => {
      const t = textOf(p, ctx);
      return {
        html: block(p, `<div style="position:relative;display:inline-block"><span class="mono" style="letter-spacing:.06em">${glyphStack(t, { step: N(p, 'stagger', 0.03), cycles: 8, slice: 0.045, glyphs: ASCII, seed: hash(t) })}</span><div class="fill scanlines"></div></div>`),
        css: '.rbx .scanlines{pointer-events:none;background:repeating-linear-gradient(0deg,#0000 0,#0000 calc(3px * var(--u)),#00000055 calc(3px * var(--u)),#00000055 calc(5px * var(--u)))}',
      };
    },
  }),
  bit({
    id: 'scrambled-text', name: 'Scrambled Text', category: 'text', level: 'intermediate',
    about: 'Letters scramble into symbols near the pointer, then snap back into order.',
    video: 'Seeded symbol stacks per letter resolve in order; the pointer becomes the reading direction.',
    use: 'Hooks, quiz reveals, announcements, "wait for it" titles.',
    props: [...T, { ...P_STAGGER, default: 0.035 }, { name: 'cycles', type: 'number', default: 6, about: 'Symbols each letter cycles through.' }],
    example: { text: 'Scrambled text' }, seconds: 4, tags: ['reveal'], textStyle: 'rb-scrambled',
    build: (p, ctx) => {
      const t = textOf(p, ctx);
      return { html: block(p, glyphStack(t, { step: N(p, 'stagger', 0.035), cycles: Math.round(Math.min(12, Math.max(2, N(p, 'cycles', 6)))), slice: 0.055, glyphs: GLYPHS, seed: hash(t) })) };
    },
  }),
  bit({
    id: 'rotating-text', name: 'Rotating Text', category: 'text', level: 'intermediate',
    about: 'A fixed phrase with one word that rotates through alternatives.',
    video: 'The static part holds; the rotating words flip in and out of an accent pill on their own time windows; the last one stays.',
    use: '"We do X / Y / Z" statements, feature lists, taglines.',
    props: [P_TEXT, P_SIZE, P_ALIGN, P_ACCENT, { ...P_ROWS, about: 'The rotating words, in order.' }, { name: 'slice', type: 'number', default: 1, about: 'Seconds each word shows.' }],
    example: { text: 'Creative', rows: ['thinking', 'coding', 'components', 'motion'], size: 'heading' }, seconds: 5, tags: ['tagline'], textStyle: 'rb-rotating',
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['thinking', 'coding', 'motion']);
      const slice = Math.max(0.4, N(p, 'slice', 1));
      const words = rows.map((w, i) => `<span class="rotw a ${i === rows.length - 1 ? '' : 'hold'}" style="${d(0.3 + i * slice)};animation-duration:${slice.toFixed(2)}s">${esc(w)}</span>`).join('');
      const widest = rows.reduce((max, w) => Math.max(max, w.length), 4);
      return {
        html: block(p, `<span class="a rise" style="${d(0)}">${esc(textOf(p, ctx))}&nbsp;</span><span class="rotpill" style="min-width:${widest * 0.58}em">${words}</span>`),
        css: '.rbx .rotpill{position:relative;display:inline-block;height:1.15em;vertical-align:baseline;padding:0 .18em;border-radius:.18em;background:var(--accent);color:#fff;overflow:hidden;text-align:center}.rbx .rotw{position:absolute;left:0;right:0;top:0;opacity:0;animation-name:rbx-rotw;animation-timing-function:var(--eo)}@keyframes rbx-rotw{0%{opacity:0;transform:translateY(60%)}14%{opacity:1;transform:none}86%{opacity:1;transform:none}100%{opacity:0;transform:translateY(-60%)}}',
      };
    },
  }),
  bit({
    id: 'glitch-text', name: 'Glitch Text', category: 'text', level: 'intermediate',
    about: 'RGB-split glitch slices tear across the text.',
    video: 'Three stacked copies; the red and cyan ghosts clip to stepped slices and shift on a paused loop over a pop entrance.',
    use: 'Intros, drops, high-energy cuts, gaming.',
    props: [...T, P_SPEED, { name: 'intensity', type: 'number', default: 1, about: 'Offset of the colour ghosts.' }], example: { text: 'GLITCH' }, seconds: 4, tags: ['glitch', 'loop'], textStyle: 'rb-glitch',
    build: (p, ctx) => {
      const t = esc(textOf(p, ctx));
      const k = Math.min(2, Math.max(0.3, N(p, 'intensity', 1)));
      const dur = (1.6 / speedOf(p)).toFixed(2);
      return {
        html: block(p, `<div class="a pop glitchwrap" style="${d(0.05)};--k:${k}"><span class="g0">${t}</span><span class="g1 loop" style="animation-duration:${dur}s">${t}</span><span class="g2 loop" style="animation-duration:${dur}s;animation-delay:calc(var(--t) + var(--at,0s) - .4s)">${t}</span></div>`),
        css: '.rbx .glitchwrap{position:relative;display:inline-block;font-weight:800}.rbx .g1,.rbx .g2{position:absolute;left:0;top:0;width:100%;mix-blend-mode:screen}.rbx .g1{color:#ff2d55;animation-name:rbx-gl1;animation-timing-function:steps(8,end)}.rbx .g2{color:#36d8ff;animation-name:rbx-gl2;animation-timing-function:steps(8,end)}@keyframes rbx-gl1{0%{clip-path:inset(10% 0 78% 0);transform:translateX(calc(-6px * var(--k)))}20%{clip-path:inset(55% 0 20% 0);transform:translateX(calc(5px * var(--k)))}40%{clip-path:inset(30% 0 60% 0);transform:translateX(calc(-3px * var(--k)))}60%{clip-path:inset(80% 0 5% 0);transform:translateX(calc(7px * var(--k)))}80%{clip-path:inset(0 0 90% 0);transform:translateX(calc(-5px * var(--k)))}100%{clip-path:inset(45% 0 40% 0);transform:translateX(calc(4px * var(--k)))}}@keyframes rbx-gl2{0%{clip-path:inset(60% 0 25% 0);transform:translateX(calc(6px * var(--k)))}20%{clip-path:inset(5% 0 80% 0);transform:translateX(calc(-5px * var(--k)))}40%{clip-path:inset(70% 0 10% 0);transform:translateX(calc(3px * var(--k)))}60%{clip-path:inset(25% 0 65% 0);transform:translateX(calc(-7px * var(--k)))}80%{clip-path:inset(85% 0 0 0);transform:translateX(calc(5px * var(--k)))}100%{clip-path:inset(15% 0 70% 0);transform:translateX(calc(-4px * var(--k)))}}',
      };
    },
  }),
  bit({
    id: 'scroll-velocity', name: 'Scroll Velocity', category: 'text', level: 'intermediate',
    about: 'Two rows of text scroll opposite ways, skewing with scroll speed.',
    video: 'Two marquee rows on paused loops moving in opposite directions with a fixed skew; repeat the copy so the rows never run out.',
    use: 'Sport, hype, fast montages, brand walls.',
    props: [P_TEXT, P_ACCENT, P_SPEED, { ...P_ROWS, about: 'Row texts (1–2). Defaults to the copy twice.' }, { name: 'fontSize', type: 'number', default: 120, about: 'Design pixels.' }],
    example: { text: 'React Bits • Scroll Velocity •' }, seconds: 6, layout: 'fullscreen', tags: ['marquee', 'hype'], textStyle: 'rb-scroll-velocity',
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, [textOf(p, ctx), textOf(p, ctx)]);
      const a = rows[0];
      const b = rows[1] ?? rows[0];
      const line = (t: string, cls: string, skew: string) => `<div class="vrow" style="transform:skewX(${skew})"><div class="vtrack loop ${cls}" style="animation-duration:${(10 / speedOf(p)).toFixed(1)}s">${`<span>${esc(t)}&nbsp;</span>`.repeat(8)}</div></div>`;
      return {
        html: `<div class="x fill col" style="justify-content:center;gap:${px(24)};font-size:${px(N(p, 'fontSize', 120))};font-weight:800;letter-spacing:-.04em;${accentStyle(p)}">${line(a, 'marquee', '-6deg')}${line(b, 'marquee-r', '6deg')}</div>`,
        css: '.rbx .vrow{overflow:hidden;white-space:nowrap}.rbx .vtrack{display:inline-block;white-space:nowrap}.rbx .vrow:nth-child(2) .vtrack{color:var(--accent)}',
      };
    },
  }),
  bit({
    id: 'variable-proximity', name: 'Variable Proximity', category: 'text', level: 'intermediate',
    about: 'Letter weight swells around the pointer as it moves across the text.',
    video: 'A swell travels along the letters: each letter pulses heavy and slightly larger in turn on a paused loop.',
    use: 'Karaoke captions, lyric highlights, playful headlines.',
    props: [...T, P_SPEED], example: { text: 'Hover me! And then star React Bits on GitHub, or else' }, seconds: 5, tags: ['variable', 'loop'], textStyle: 'rb-variable-proximity',
    build: (p, ctx) => ({
      html: block(p, `<div class="a rise" style="${d(0.05)}">${letters(textOf(p, ctx), { step: 0.07, cls: 'ch loop prox', style: () => `animation-duration:${(2.2 / speedOf(p)).toFixed(2)}s` })}</div>`),
      css: '.rbx .prox{animation-name:rbx-prox;animation-timing-function:ease-in-out;font-weight:300;transform-origin:50% 100%}@keyframes rbx-prox{0%,100%{font-weight:300;transform:scale(1)}50%{font-weight:900;transform:scale(1.08,1.12)}}',
    }),
  }),
  bit({
    id: 'count-up', name: 'Count Up', category: 'text', level: 'basic',
    about: 'A number counts up to its value with easing.',
    video: 'Digit columns roll to their final digit with ease-out; prefix, suffix and separators stay put. Uses the real value you pass.',
    use: 'Stats, prices, milestones, subscriber counts — verified numbers only.',
    props: [P_SIZE, P_ALIGN, P_ACCENT, { name: 'value', type: 'number', default: 1000, about: 'The number to reach.' }, { name: 'prefix', type: 'string', about: 'Text before the number ($, +).' }, { name: 'suffix', type: 'string', about: 'Text after (%, K, M, users).' }, { name: 'seconds', type: 'number', default: 1.6, about: 'How long the roll takes.' }, { name: 'separator', type: 'boolean', default: true, about: 'Thousands separators.' }, { name: 'label', type: 'string', about: 'A small line under the number.' }],
    example: { value: 340, suffix: '%', prefix: '+', label: 'growth this quarter' }, seconds: 5, tags: ['stat', 'number'], textStyle: 'rb-count-up',
    build: (p, ctx) => {
      const value = Math.round(Math.abs(N(p, 'value', ctx.values[0] ?? 1000)));
      const text = B(p, 'separator', true) ? value.toLocaleString('en-US') : String(value);
      const roll = Math.max(0.3, N(p, 'seconds', 1.6));
      let digitIndex = 0;
      const digitsTotal = text.replace(/\D/g, '').length;
      const cols = Array.from(text).map((ch) => {
        if (!/\d/.test(ch)) return `<span class="cu-static">${esc(ch)}</span>`;
        const i = digitIndex++;
        const delay = 0.15 + (digitsTotal - 1 - i) * 0.05;
        return `<span class="cu-col"><span class="cu-strip a" style="--n:${ch};${d(delay)};animation-duration:${roll.toFixed(2)}s">${'0123456789'.split('').map((n) => `<i>${n}</i>`).join('')}</span></span>`;
      }).join('');
      const label = S(p, 'label') ? `<div class="small a rise" style="margin-top:${px(18)};${d(roll + 0.2)}">${esc(S(p, 'label'))}</div>` : '';
      return {
        html: block(p, `<div class="num a fade" style="${d(0)}"><span class="cu-static">${esc(S(p, 'prefix'))}</span>${cols}<span class="cu-static">${esc(S(p, 'suffix'))}</span></div>${label}`),
        css: '.rbx .cu-col{display:inline-block;height:1em;line-height:1;overflow:hidden;vertical-align:top}.rbx .cu-static{display:inline-block;line-height:1;vertical-align:top}.rbx .cu-strip{display:inline-flex;flex-direction:column;line-height:1;animation-name:rbx-roll;animation-timing-function:var(--eo)}.rbx .cu-strip>i{display:block;height:1em;font-style:normal}@keyframes rbx-roll{from{transform:translateY(0)}to{transform:translateY(calc(var(--n,0) * -1em))}}',
      };
    },
  }),
  bit({
    id: 'text-loop', name: 'Text Loop', category: 'text', level: 'intermediate',
    about: 'Phrases cycle in place on a loop.',
    video: 'Each phrase owns an equal window of an infinite paused cycle: rises in, holds, lifts out.',
    use: 'Rotating offers, multi-line hooks, "now playing" lines.',
    props: [P_SIZE, P_ALIGN, P_ACCENT, { ...P_ROWS, about: 'The phrases to cycle.' }, { name: 'slice', type: 'number', default: 1.2, about: 'Seconds each phrase shows.' }],
    example: { rows: ['Design', 'Animate', 'Ship'], size: 'hero' }, seconds: 6, tags: ['loop', 'tagline'], textStyle: 'rb-text-loop',
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, [textOf(p, ctx), 'Animate', 'Ship']);
      const slice = Math.max(0.4, N(p, 'slice', 1.2));
      const n = rows.length;
      const cycle = slice * n;
      const inPct = (100 / n) * 0.12;
      const holdPct = 100 / n - inPct;
      const endPct = 100 / n;
      return {
        html: block(p, `<div class="tl-stage" style="height:1.2em">${rows.map((r, i) => `<div class="tl-row loop" style="${d(i * slice)};animation-duration:${cycle.toFixed(2)}s">${esc(r)}</div>`).join('')}</div>`),
        css: `.rbx .tl-stage{position:relative;width:100%}.rbx .tl-row{position:absolute;left:0;right:0;top:0;opacity:0;animation-name:rbx-tl-${n};animation-timing-function:var(--eo)}@keyframes rbx-tl-${n}{0%{opacity:0;transform:translateY(40%)}${inPct.toFixed(2)}%{opacity:1;transform:none}${holdPct.toFixed(2)}%{opacity:1;transform:none}${endPct.toFixed(2)}%{opacity:0;transform:translateY(-40%)}100%{opacity:0;transform:translateY(-40%)}}`,
      };
    },
  }),
  bit({
    id: 'masked-heading', name: 'Masked Heading', category: 'text', level: 'basic',
    about: 'Oversized type wipes in behind a mask bar.',
    video: 'A clip-path wipe reveals the heading from the left while an accent bar leads the edge, then fades.',
    use: 'Cinematic titles, section headers, chapter cards.',
    props: [...T, P_SUBTITLE], example: { text: 'Chapter Two', subtitle: 'Where the plan meets the timeline', size: 'display' }, seconds: 4, tags: ['title', 'wipe'], textStyle: 'rb-masked-heading',
    build: (p, ctx) => ({
      html: block(p, `<div style="position:relative;display:inline-block"><div class="a wipe" style="${d(0.1)}">${esc(textOf(p, ctx))}</div><div class="bar a barwipe" style="${d(0.1)}"></div></div>${sub(p, ctx, 0.9)}`),
      css: '.rbx .wipe{animation-name:rbx-wipe;animation-duration:.9s;animation-timing-function:var(--eo)}.rbx .bar{position:absolute;top:0;bottom:0;width:.08em;background:var(--accent);animation-name:rbx-barwipe;animation-duration:.9s;animation-timing-function:var(--eo)}@keyframes rbx-wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}@keyframes rbx-barwipe{0%{left:0;opacity:1}90%{left:100%;opacity:1}100%{left:100%;opacity:0}}',
    }),
  }),
  bit({
    id: 'particle-text', name: 'Particle Text', category: 'text', level: 'advanced',
    about: 'Letters coalesce from drifting particles.',
    video: 'Every letter flies in from a seeded offset, small and blurred, while seeded dust motes fade and drift around the line.',
    use: 'Fantasy, intros, channel branding, magic reveals.',
    props: [...T, { ...P_STAGGER, default: 0.04 }, { name: 'spread', type: 'number', default: 1, about: '0.3–2: how far the letters start from home.' }],
    example: { text: 'Particle Text' }, seconds: 5, tags: ['particles', 'intro'], textStyle: 'rb-particle-text',
    build: (p, ctx) => {
      const t = textOf(p, ctx);
      const rand = rng(hash(t));
      const spread = Math.min(2, Math.max(0.3, N(p, 'spread', 1))) * 260;
      const chars = letters(t, { from: 0.2, step: N(p, 'stagger', 0.04), cls: 'ch a particle', style: () => `--ox:${px((rand() - 0.5) * 2 * spread)};--oy:${px((rand() - 0.5) * 2 * spread)}` });
      const dust = Array.from({ length: 36 }, () => `<i class="dust a fade" style="left:${(rand() * 100).toFixed(1)}%;top:${(rand() * 100).toFixed(1)}%;width:${px(3 + rand() * 5)};height:${px(3 + rand() * 5)};${d(0.1 + rand() * 1.2)};--alpha:${(0.3 + rand() * 0.6).toFixed(2)};animation-duration:${(0.6 + rand()).toFixed(2)}s"></i>`).join('');
      return {
        html: block(p, `<div style="position:relative;display:inline-block;padding:.3em .4em"><div class="fill loop float" style="animation-duration:5s">${dust}</div>${chars}</div>`),
        css: '.rbx .particle{animation-name:rbx-particle;animation-duration:1.1s;animation-timing-function:var(--eo)}.rbx .dust{position:absolute;border-radius:50%;background:var(--accent2);box-shadow:0 0 calc(10px * var(--u)) var(--accent)}@keyframes rbx-particle{from{opacity:0;transform:translate(var(--ox),var(--oy)) scale(.2);filter:blur(calc(8px * var(--u)))}to{opacity:1;transform:none;filter:blur(0)}}',
      };
    },
  }),
  bit({
    id: 'split-flap-text', name: 'Split Flap Text', category: 'text', level: 'intermediate',
    about: 'Departure-board flaps roll into each character.',
    video: 'Monospace glyph stacks where every glyph flips in and out around a horizontal seam, landing on the copy.',
    use: 'Scores, dates, times, retro travel, station boards.',
    props: [...T, { ...P_STAGGER, default: 0.05 }], example: { text: 'DEPARTING 18:40' }, seconds: 4, tags: ['retro', 'board'], textStyle: 'rb-split-flap',
    build: (p, ctx) => {
      const t = textOf(p, ctx).toUpperCase();
      return {
        html: block(p, `<span class="mono flapline">${glyphStack(t, { step: N(p, 'stagger', 0.05), cycles: 5, slice: 0.075, glyphs: CIPHER, seed: hash(t), cls: 'flap' })}</span>`),
        css: '.rbx .flapline .gs{margin:0 .03em;padding:0 .06em;border-radius:.08em;background:#0b0b0f;color:#f3f3f3;box-shadow:inset 0 0 0 1px #ffffff14}.rbx .flapline .gs>i{color:#f3f3f3aa}.rbx .flapline .gs:after{content:"";position:absolute;left:0;right:0;top:50%;height:1px;background:#00000099}',
      };
    },
  }),
  bit({
    id: 'warp-text', name: 'Warp Text', category: 'text', level: 'intermediate',
    about: 'Type bends through a wave as it moves.',
    video: 'Letters rise in, then ride a staggered sine-like wave (translate + skew) on a paused loop.',
    use: 'Psychedelic and music visuals, playful brands.',
    props: [...T, P_SPEED, { name: 'intensity', type: 'number', default: 1, about: 'Wave height.' }], example: { text: 'Warp Text' }, seconds: 4, tags: ['wave', 'loop'], textStyle: 'rb-warp',
    build: (p, ctx) => ({
      html: block(p, `<div class="a rise" style="${d(0.05)};--k:${Math.min(2, Math.max(0.3, N(p, 'intensity', 1)))}">${letters(textOf(p, ctx), { step: 0.09, cls: 'ch loop warp', style: () => `animation-duration:${(1.8 / speedOf(p)).toFixed(2)}s` })}</div>`),
      css: '.rbx .warp{animation-name:rbx-warp;animation-timing-function:ease-in-out}@keyframes rbx-warp{0%,100%{transform:translateY(0) skewX(0) rotate(0)}50%{transform:translateY(calc(-.14em * var(--k,1))) skewX(calc(-9deg * var(--k,1))) rotate(calc(-3deg * var(--k,1)))}}',
    }),
  }),
  bit({
    id: 'stroke-text', name: 'Stroke Text', category: 'text', level: 'intermediate',
    about: 'Outlined type whose stroke draws in before the fill arrives.',
    video: 'An outline layer (text-stroke) wipes in left to right, then the solid fill fades over it.',
    use: 'Elegant titles, weddings, luxury, fashion.',
    props: [...T], example: { text: 'Elegance', size: 'display' }, seconds: 4, tags: ['outline', 'luxury'], textStyle: 'rb-stroke',
    build: (p, ctx) => {
      const t = esc(textOf(p, ctx));
      return {
        html: block(p, `<div class="stk-wrap"><span class="stk a wipe" style="${d(0.1)}">${t}</span><span class="stk-fill a fade" style="${d(1.1)}">${t}</span></div>`),
        css: '.rbx .stk-wrap{position:relative;display:inline-block}.rbx .stk{display:inline-block;-webkit-text-stroke:calc(2px * var(--u)) var(--fg);color:transparent;animation-name:rbx-wipe;animation-duration:1s;animation-timing-function:var(--eo)}.rbx .stk-fill{position:absolute;left:0;top:0;animation-duration:.8s}@keyframes rbx-wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}',
      };
    },
  }),
  bit({
    id: 'depth-text', name: 'Depth Text', category: 'text', level: 'intermediate',
    about: 'Layered extrusion gives the word 3D thickness that tilts with the pointer.',
    video: 'Seven stacked copies offset diagonally build the extrusion in order; the stack bobs gently on a loop.',
    use: 'Sport, gaming, 3D-feel thumbnails, big numbers.',
    props: [...T, { name: 'depth', type: 'number', default: 7, about: 'Extrusion layers (2–12).' }], example: { text: 'DEPTH', size: 'display' }, seconds: 4, tags: ['3d'], textStyle: 'rb-depth',
    build: (p, ctx) => {
      const t = esc(textOf(p, ctx));
      const n = Math.round(Math.min(12, Math.max(2, N(p, 'depth', 7))));
      const layers = Array.from({ length: n }, (_, i) => {
        const k = n - 1 - i;
        return `<span class="dl a rise" style="transform:translate(${px(k * 3)},${px(k * 3)});color:${k === 0 ? 'var(--fg)' : `color-mix(in srgb,var(--accent) ${Math.round(100 - (k / n) * 60)}%,#000)`};${d(0.05 + i * 0.05)}">${t}</span>`;
      }).join('');
      return { html: block(p, `<div class="loop bob dstack" style="position:relative;display:inline-block;animation-duration:3.5s">${layers}</div>`), css: '.rbx .dstack{display:inline-grid}.rbx .dl{grid-area:1/1;display:inline-block;font-weight:800}' };
    },
  }),
  bit({
    id: 'fold-text', name: 'Fold Text', category: 'text', level: 'intermediate',
    about: 'Words unfold from a crease like paper.',
    video: 'Words flip down from the top edge with perspective, one after another.',
    use: 'Editorial, invitations, lookbooks, elegant section titles.',
    props: [...T, { ...P_STAGGER, default: 0.1 }], example: { text: 'Unfold the idea' }, seconds: 4, tags: ['paper', 'editorial'], textStyle: 'rb-fold',
    build: (p, ctx) => ({ html: block(p, `<div style="perspective:${px(900)}">${wordsOf(textOf(p, ctx), { step: N(p, 'stagger', 0.1), cls: 'w a fold' })}</div>`), css: '.rbx .fold{animation-name:rbx-fold;animation-duration:.8s;animation-timing-function:var(--eo);transform-origin:50% 0}@keyframes rbx-fold{from{opacity:0;transform:rotateX(-92deg)}60%{opacity:1;transform:rotateX(12deg)}to{opacity:1;transform:rotateX(0)}}' }),
  }),
  bit({
    id: 'echo-text', name: 'Echo Text', category: 'text', level: 'intermediate',
    about: 'Ghost copies trail the word into place.',
    video: 'The word slides in; three fading ghosts follow a beat behind with a growing horizontal offset.',
    use: 'Concerts, speed, power moments, sport idents.',
    props: [...T, { name: 'echoes', type: 'number', default: 3, about: 'Ghost copies (1–5).' }], example: { text: 'ECHO' }, seconds: 4, tags: ['ghost', 'speed'], textStyle: 'rb-echo',
    build: (p, ctx) => {
      const t = esc(textOf(p, ctx));
      const n = Math.round(Math.min(5, Math.max(1, N(p, 'echoes', 3))));
      const ghosts = Array.from({ length: n }, (_, i) => `<span class="echo a slide-r" style="left:${px((i + 1) * 16)};opacity:${(0.5 / (i + 1)).toFixed(2)};${d(0.12 + i * 0.08)};--alpha:${(0.5 / (i + 1)).toFixed(2)}">${t}</span>`).join('');
      return { html: block(p, `<div style="position:relative;display:inline-block"><span class="a slide-r" style="position:relative;z-index:2;${d(0.05)}">${t}</span>${ghosts}</div>`), css: '.rbx .echo{position:absolute;top:0;color:var(--accent);filter:blur(1px);z-index:1}' };
    },
  }),
];
