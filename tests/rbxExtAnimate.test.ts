import { describe, expect, it } from 'vitest';
import { RBX_BASE_CSS, themeOf, type Bit, type BitContext } from '../src/lib/rbx/core';
import {
  ANIMATE_CSS_BITS, ANIMATE_CSS_EXITS, ANIMATE_CSS_GROUPS, ANIMATE_CSS_KEYFRAMES, ANIMATE_CSS_NAMES,
  animateCssEntrance, animateCssExit, scalePx,
} from '../src/lib/rbx/ext/animateCss';
import {
  OPEN_PROPS_ANIMATIONS, OPEN_PROPS_BITS, OPEN_PROPS_BORDERS, OPEN_PROPS_COLORS, OPEN_PROPS_EASINGS, OPEN_PROPS_FONTS,
  OPEN_PROPS_GRADIENTS, OPEN_PROPS_HUES, OPEN_PROPS_SHADOWS, OPEN_PROPS_SIZES,
  openPropsBrandTokens, openPropsHueScale, openPropsStyle, openPropsVars,
} from '../src/lib/rbx/ext/openProps';

const ctx: BitContext = {
  canvas: { width: 1920, height: 1080 }, u: 1, portrait: false, duration: 4, layout: 'centre-card', theme: themeOf('crimson'), seed: 1,
  text: 'Motion is not difficult', subtitle: 'sub', rows: ['One — a', 'Two — b'], values: [1, 2],
};
const lightCtx: BitContext = { ...ctx, theme: themeOf('light') };
const portraitCtx: BitContext = { ...ctx, canvas: { width: 1080, height: 1920 }, u: 1080 / 1920, portrait: true, layout: 'fullscreen' };

const HEX = /^#[0-9a-f]{6}$/i;

function checkBits(bits: Bit[], prefix: 'ac-' | 'op-', source: string) {
  const ids = bits.map((b) => b.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const bit of bits) {
    expect(bit.id, bit.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(bit.id.startsWith(prefix), bit.id).toBe(true);
    expect(bit.source, bit.id).toBe(source);
    expect(['text', 'animation', 'component', 'micro', 'background']).toContain(bit.category);
    expect(['basic', 'intermediate', 'advanced']).toContain(bit.level);
    expect(bit.about.length, bit.id).toBeGreaterThan(10);
    expect(bit.video.length, bit.id).toBeGreaterThan(10);
    expect(bit.use.length, bit.id).toBeGreaterThan(5);
    expect(bit.seconds, bit.id).toBeGreaterThan(0);
    expect(bit.tags.length, bit.id).toBeGreaterThan(0);
    for (const props of [{}, bit.example]) {
      for (const c of [ctx, lightCtx, portraitCtx]) {
        const out = bit.build(props, c);
        const css = RBX_BASE_CSS + (out.css ?? '');
        const label = `${bit.id} ${JSON.stringify(props)}`;
        expect(out.html.length, label).toBeGreaterThan(40);
        expect(css, label).toContain('animation-play-state:paused');
        expect(css, label).toContain('--elapsed');
        expect(css, label).not.toMatch(/backdrop-filter/);
        expect(out.html + css, label).not.toMatch(/url\(["']?https?:/);
        expect(out.html + css, label).not.toMatch(/<img\b|<video\b|<canvas\b|<script\b|<iframe\b/);
        expect(out.html, label).not.toMatch(/undefined|NaN/);
        expect(css, label).not.toMatch(/undefined|NaN/);
        if (out.box) {
          expect(out.box.x).toBeGreaterThanOrEqual(0);
          expect(out.box.y).toBeGreaterThanOrEqual(0);
          expect(out.box.x + out.box.width).toBeLessThanOrEqual(1.0001);
          expect(out.box.y + out.box.height).toBeLessThanOrEqual(1.0001);
        }
      }
    }
  }
}

describe('Animate.css data', () => {
  it('hardcodes every animation with rbx-ac keyframes scaled by --u', () => {
    const names = Object.keys(ANIMATE_CSS_KEYFRAMES);
    expect(names.length).toBeGreaterThanOrEqual(90);
    expect(names.length).toBe(97);
    for (const name of names) {
      const css = ANIMATE_CSS_KEYFRAMES[name];
      expect(css, name).toContain('@keyframes rbx-ac-');
      expect(css, name).toMatch(/^@keyframes rbx-ac-[a-z0-9-]+\{.*\}$/);
      // no unscaled non-zero px lengths remain
      expect(css.replace(/calc\((-?\d*\.?\d+)px \* var\(--u\)\)/g, ''), name).not.toMatch(/[1-9]\d*px|0\.\d+px/);
    }
    expect(ANIMATE_CSS_KEYFRAMES.bounceInDown).toContain('calc(-3000px * var(--u))');
    expect(ANIMATE_CSS_KEYFRAMES.flipInX).toContain('perspective(calc(400px * var(--u)))');
    expect(ANIMATE_CSS_KEYFRAMES.hinge).toContain('calc(700px * var(--u))');
    expect(ANIMATE_CSS_KEYFRAMES.lightSpeedInRight).toContain('skewX(-30deg)');
    expect(ANIMATE_CSS_KEYFRAMES.fadeIn).toBe('@keyframes rbx-ac-fade-in{from{opacity:0}to{opacity:1}}');
  });

  it('groups mirror the source folders and cover every keyframe once', () => {
    expect(ANIMATE_CSS_GROUPS.map((g) => g.group)).toEqual([
      'attention_seekers', 'back_entrances', 'back_exits', 'bouncing_entrances', 'bouncing_exits', 'fading_entrances', 'fading_exits', 'flippers',
      'lightspeed', 'rotating_entrances', 'rotating_exits', 'specials', 'zooming_entrances', 'zooming_exits', 'sliding_entrances', 'sliding_exits',
    ]);
    expect(ANIMATE_CSS_NAMES.length).toBe(97);
    expect(new Set(ANIMATE_CSS_NAMES).size).toBe(97);
    for (const name of ANIMATE_CSS_NAMES) expect(ANIMATE_CSS_KEYFRAMES[name], name).toBeTruthy();
    expect(ANIMATE_CSS_EXITS).toContain('fadeOut');
    expect(ANIMATE_CSS_EXITS).toContain('hinge');
    expect(ANIMATE_CSS_EXITS).toContain('rollOut');
    expect(ANIMATE_CSS_EXITS).not.toContain('flip');
    expect(ANIMATE_CSS_EXITS).not.toContain('jackInTheBox');
    expect(ANIMATE_CSS_EXITS.length).toBe(42);
  });

  it('entrance and exit helpers carry the library defaults', () => {
    const e = animateCssEntrance('bounceIn', { delay: 0.4 });
    expect(e.cls).toBe('ac-bounce-in');
    expect(e.css).toContain('@keyframes rbx-ac-bounce-in{');
    expect(e.css).toContain('.rbx .ac-bounce-in{animation-name:rbx-ac-bounce-in;animation-duration:0.75s');
    expect(e.style).toBe('--d:0.40s');
    const h = animateCssEntrance('hinge', { duration: 1.5 });
    expect(h.css).toContain('animation-duration:2s');
    expect(h.css).toContain('transform-origin:top left');
    expect(h.style).toContain('animation-duration:1.50s');
    expect(animateCssEntrance('lightSpeedInRight').css).toContain('animation-timing-function:ease-out');
    expect(animateCssEntrance('flipInX').css).toContain('backface-visibility:visible');
    expect(animateCssEntrance('nope').cls).toBe('ac-fade-in');
    const x = animateCssExit('zoomOutDown');
    expect(x.cls).toBe('acx ac-zoom-out-down');
    expect(x.style).toBe('animation-duration:1.00s;animation-delay:calc(var(--exit) + .3s - 1.00s)');
    expect(x.css).toContain('.rbx .acx{animation-fill-mode:both;animation-play-state:paused}');
    expect(x.css).toContain('transform-origin:center bottom');
    expect(scalePx('translate(0, 30px) blur(0px) 1.5px')).toBe('translate(0, calc(30px * var(--u))) blur(0px) calc(1.5px * var(--u))');
  });
});

describe('Animate.css bits', () => {
  it('one bit per animation, all building scrub-safe and export-safe', () => {
    expect(ANIMATE_CSS_BITS.length).toBe(97);
    checkBits(ANIMATE_CSS_BITS, 'ac-', 'animate-css');
    for (const b of ANIMATE_CSS_BITS) {
      expect(b.category).toBe('animation');
      expect(b.tags).toContain('animate.css');
      expect(b.seconds).toBeGreaterThanOrEqual(3);
      expect(b.seconds).toBeLessThanOrEqual(4);
    }
    const byId = new Map(ANIMATE_CSS_BITS.map((b) => [b.id, b]));
    expect(byId.get('ac-bounce-in-left')?.level).toBe('intermediate');
    expect(byId.get('ac-fade-in')?.level).toBe('basic');
    expect(byId.get('ac-tada')?.level).toBe('basic');
    expect(byId.get('ac-slide-in-up')?.level).toBe('basic');
    expect(byId.get('ac-hinge')?.level).toBe('advanced');
    expect(byId.get('ac-jack-in-the-box')?.level).toBe('advanced');
  });

  it('entrances enter at 0.1 s, exits ride the --exit clock, attention seekers repeat', () => {
    const byId = new Map(ANIMATE_CSS_BITS.map((b) => [b.id, b]));
    const enter = byId.get('ac-zoom-in')!.build({}, ctx);
    expect(enter.html).toContain('class="a ac-zoom-in"');
    expect(enter.html).toContain('--d:0.10s');
    expect(enter.html).toContain('class="x"');
    expect(enter.css).toContain('@keyframes rbx-ac-zoom-in{');
    const withExit = byId.get('ac-zoom-in')!.build({ exit: 'zoomOutDown', mode: 'text' }, ctx);
    expect(withExit.html).toContain('class="acx ac-zoom-out-down"');
    expect(withExit.html).toContain('animation-delay:calc(var(--exit) + .3s - 1.00s)');
    expect(withExit.html).not.toContain('class="x"');
    expect(withExit.html).toContain('class="hero"');
    expect(withExit.css).toContain('@keyframes rbx-ac-zoom-out-down{');
    const badExit = byId.get('ac-zoom-in')!.build({ exit: 'bounceIn' }, ctx);
    expect(badExit.html).toContain('class="x"');
    const exitBit = byId.get('ac-fade-out-up')!.build({ duration: 0.8 }, ctx);
    expect(exitBit.html).toContain('class="acx ac-fade-out-up"');
    expect(exitBit.html).toContain('animation-delay:calc(var(--exit) + .3s - 0.80s)');
    expect(exitBit.html).toContain('class="a fade"');
    expect(byId.get('ac-fade-out-up')!.props.some((p) => p.name === 'exit')).toBe(false);
    const seeker = byId.get('ac-tada')!.build({ repeat: 3 }, ctx);
    expect(seeker.html).toContain('class="a ac-tada"');
    expect(seeker.html).toContain('animation-iteration-count:3');
    expect(seeker.html).toContain('--d:0.45s');
    expect(seeker.html).toContain('class="glass');
    expect(byId.get('ac-flip')!.props.some((p) => p.name === 'repeat')).toBe(true);
  });

  it('escapes copy', () => {
    const out = ANIMATE_CSS_BITS[0].build({ text: 'A <b> & "c"', subtitle: '<i>' }, ctx);
    expect(out.html).toContain('A &lt;b&gt; &amp; &quot;c&quot;');
    expect(out.html).not.toContain('<b>');
    expect(out.html).not.toContain('<i>');
  });
});

describe('Open Props data', () => {
  it('easings', () => {
    expect(OPEN_PROPS_EASINGS['ease-3']).toBe('cubic-bezier(.25, 0, .3, 1)');
    expect(OPEN_PROPS_EASINGS['ease-elastic-3']).toBe('cubic-bezier(.5, 1.25, .75, 1.25)');
    expect(OPEN_PROPS_EASINGS['ease-elastic-out-3']).toBe(OPEN_PROPS_EASINGS['ease-elastic-3']);
    expect(OPEN_PROPS_EASINGS['ease-squish-2']).toBe('cubic-bezier(.5, -.3, .1, 1.5)');
    expect(OPEN_PROPS_EASINGS['ease-spring-3']).toMatch(/^linear\(0, 0\.009, 0\.035 2\.1%/);
    expect(OPEN_PROPS_EASINGS['ease-bounce-5']).toMatch(/^linear\(/);
    expect(OPEN_PROPS_EASINGS['ease-step-5']).toBe('steps(10)');
    for (const fam of ['ease', 'ease-in', 'ease-out', 'ease-in-out', 'ease-elastic-in', 'ease-elastic-out', 'ease-elastic-in-out', 'ease-elastic', 'ease-squish', 'ease-spring', 'ease-bounce', 'ease-step']) {
      for (let i = 1; i <= 5; i++) expect(OPEN_PROPS_EASINGS[`${fam}-${i}`], `${fam}-${i}`).toBeTruthy();
    }
    for (const v of Object.values(OPEN_PROPS_EASINGS)) expect(v).not.toMatch(/var\(/);
  });

  it('animations', () => {
    expect(Object.keys(OPEN_PROPS_ANIMATIONS)).toEqual([
      'fade-in', 'fade-in-bloom', 'fade-out', 'fade-out-bloom', 'scale-up', 'scale-down', 'slide-out-up', 'slide-out-down', 'slide-out-right', 'slide-out-left',
      'slide-in-up', 'slide-in-down', 'slide-in-right', 'slide-in-left', 'shake-x', 'shake-y', 'shake-z', 'spin', 'ping', 'blink', 'float', 'bounce', 'pulse',
    ]);
    for (const [name, a] of Object.entries(OPEN_PROPS_ANIMATIONS)) {
      expect(a.keyframes, name).toContain(`@keyframes rbx-op-${name}{`);
      expect(a.duration, name).toBeGreaterThan(0);
      expect(a.easing === 'linear' || a.easing in OPEN_PROPS_EASINGS, name).toBe(true);
    }
    expect(OPEN_PROPS_ANIMATIONS.spin.shorthand).toBe('spin 2s linear infinite');
    expect(OPEN_PROPS_ANIMATIONS['fade-in'].shorthand).toBe('fade-in .5s var(--ease-3)');
    expect(OPEN_PROPS_ANIMATIONS.bounce.shorthand).toBe('bounce 2s var(--ease-squish-2) infinite');
    expect(OPEN_PROPS_ANIMATIONS['fade-in-bloom'].keyframes).toContain('blur(calc(20px * var(--u)))');
    expect(OPEN_PROPS_ANIMATIONS['fade-in-bloom'].dark).toContain('brightness(0.5)');
    expect(OPEN_PROPS_ANIMATIONS['slide-in-right'].keyframes).toContain('translateX(-100%)');
  });

  it('gradients, shadows, fonts, sizes, borders', () => {
    expect(Object.keys(OPEN_PROPS_GRADIENTS).length).toBe(30);
    for (let i = 1; i <= 30; i++) {
      const g = OPEN_PROPS_GRADIENTS[`gradient-${i}`];
      expect(g, `gradient-${i}`).toMatch(/^(linear|radial|conic)-gradient\(/);
      expect(g).not.toContain('var(');
    }
    expect(OPEN_PROPS_GRADIENTS['gradient-7']).toBe('linear-gradient(to bottom right, #72C6EF, #004E8F)');
    expect(OPEN_PROPS_GRADIENTS['gradient-18'].split('linear-gradient(').length - 1).toBe(6);
    for (const mode of ['light', 'dark'] as const) {
      for (let i = 1; i <= 6; i++) expect(OPEN_PROPS_SHADOWS[mode][`shadow-${i}`], `${mode} shadow-${i}`).toMatch(/hsl\(220 /);
      for (let i = 0; i <= 4; i++) expect(OPEN_PROPS_SHADOWS[mode][`inner-shadow-${i}`], `${mode} inner-shadow-${i}`).toMatch(/^inset /);
    }
    expect(OPEN_PROPS_SHADOWS.light['shadow-1']).toBe('0 1px 2px -1px hsl(220 3% 15% / 10%)');
    expect(OPEN_PROPS_SHADOWS.dark['shadow-1']).toBe('0 1px 2px -1px hsl(220 40% 2% / 34%)');
    expect(OPEN_PROPS_SHADOWS.light['shadow-6'].split(',').length).toBe(7);
    expect(OPEN_PROPS_FONTS['font-sans']).toBe('system-ui, sans-serif');
    expect(OPEN_PROPS_FONTS['font-mono']).toContain('monospace');
    expect(OPEN_PROPS_FONTS['font-serif']).toBe('ui-serif, serif');
    for (let i = 1; i <= 9; i++) expect(OPEN_PROPS_FONTS[`font-weight-${i}`]).toBe(String(i * 100));
    expect(OPEN_PROPS_FONTS['font-lineheight-00']).toBe('.95');
    expect(OPEN_PROPS_FONTS['font-letterspacing-7']).toBe('1em');
    expect(OPEN_PROPS_FONTS['font-size-00']).toBe('.5rem');
    expect(OPEN_PROPS_FONTS['font-size-8']).toBe('3.5rem');
    expect(OPEN_PROPS_FONTS['font-size-fluid-3']).toBe('clamp(2rem, 9vw, 3.5rem)');
    expect(OPEN_PROPS_SIZES['size-000']).toBe('-.5rem');
    expect(OPEN_PROPS_SIZES['size-15']).toBe('30rem');
    expect(OPEN_PROPS_SIZES['size-fluid-10']).toBe('clamp(20rem, 40vw, 30rem)');
    expect(OPEN_PROPS_SIZES['size-content-3']).toBe('60ch');
    expect(OPEN_PROPS_SIZES['size-header-3']).toBe('35ch');
    expect(OPEN_PROPS_BORDERS['border-size-5']).toBe('25px');
    expect(OPEN_PROPS_BORDERS['radius-6']).toBe('8rem');
    expect(OPEN_PROPS_BORDERS['radius-round']).toBe('1e5px');
    expect(OPEN_PROPS_BORDERS['radius-blob-5']).toBe('49% 51% 48% 52% / 57% 44% 56% 43%');
    expect(OPEN_PROPS_BORDERS['radius-conditional-6']).toContain('var(--radius-6)');
    expect(Object.keys(OPEN_PROPS_FONTS).some((k) => /^font-sans|font-serif|font-mono/.test(k))).toBe(true);
    for (const v of [...Object.values(OPEN_PROPS_FONTS), ...Object.values(OPEN_PROPS_GRADIENTS)]) expect(v).not.toMatch(/url\(/);
  });

  it('colors: 19 hues × 13 hex steps', () => {
    expect(OPEN_PROPS_HUES.length).toBe(19);
    for (const hue of OPEN_PROPS_HUES) {
      const steps = OPEN_PROPS_COLORS[hue];
      expect(steps.length, hue).toBe(13);
      for (const hex of steps) expect(hex, hue).toMatch(HEX);
    }
    expect(OPEN_PROPS_COLORS.red).toEqual(['#fff5f5', '#ffe3e3', '#ffc9c9', '#ffa8a8', '#ff8787', '#ff6b6b', '#fa5252', '#f03e3e', '#e03131', '#c92a2a', '#b02525', '#962020', '#7d1a1a']);
    expect(OPEN_PROPS_COLORS.gray[12]).toBe('#030507');
    expect(OPEN_PROPS_COLORS.jungle[0]).toBe('#ecfeb0');
  });

  it('helpers', () => {
    const all = openPropsVars();
    expect(all['--ease-3']).toBe('cubic-bezier(.25, 0, .3, 1)');
    expect(all['--gradient-7']).toBe(OPEN_PROPS_GRADIENTS['gradient-7']);
    expect(all['--shadow-3']).toBe(OPEN_PROPS_SHADOWS.dark['shadow-3']);
    expect(all['--red-6']).toBe('#fa5252');
    expect(all['--font-weight-7']).toBe('700');
    expect(all['--size-3']).toBe('1rem');
    expect(all['--radius-3']).toBe('1rem');
    expect(Object.keys(all).length).toBeGreaterThan(500);
    const some = openPropsVars(['ease-3', '--gradient-7', 'red-6', 'shadow-2', 'nope'], 'light');
    expect(Object.keys(some)).toEqual(['--ease-3', '--gradient-7', '--red-6', '--shadow-2']);
    expect(some['--shadow-2']).toBe(OPEN_PROPS_SHADOWS.light['shadow-2']);
    expect(openPropsStyle(['ease-3', 'red-6'])).toBe('--ease-3:cubic-bezier(.25, 0, .3, 1);--red-6:#fa5252');
    expect(openPropsHueScale('blue')).toEqual(OPEN_PROPS_COLORS.blue);
    expect(openPropsHueScale('nope')).toEqual(OPEN_PROPS_COLORS.gray);
    openPropsHueScale('blue').push('#000000');
    expect(OPEN_PROPS_COLORS.blue.length).toBe(13);
    const dark = openPropsBrandTokens('red', 'dark');
    expect(dark).toEqual({ bg: '#7d1a1a', surface: '#962020', text: '#fff5f5', muted: '#ffa8a8', primary: '#fa5252', accent: '#ff6b6b', accent2: '#ffa8a8' });
    const light = openPropsBrandTokens('blue', 'light');
    expect(light.bg).toBe('#e7f5ff');
    expect(light.text).toBe('#0d375e');
    for (const v of Object.values(light)) expect(v).toMatch(HEX);
  });
});

describe('Open Props bits', () => {
  it('23 animations, 30 gradients and the shadow scale, all building scrub-safe and export-safe', () => {
    expect(OPEN_PROPS_BITS.length).toBe(54);
    checkBits(OPEN_PROPS_BITS, 'op-', 'open-props');
    const anims = OPEN_PROPS_BITS.filter((b) => b.category === 'animation');
    const grads = OPEN_PROPS_BITS.filter((b) => b.category === 'background');
    const comps = OPEN_PROPS_BITS.filter((b) => b.category === 'component');
    expect(anims.length).toBe(23);
    expect(grads.length).toBe(30);
    expect(comps.map((b) => b.id)).toEqual(['op-shadow-card']);
    for (const name of Object.keys(OPEN_PROPS_ANIMATIONS)) expect(anims.some((b) => b.id === `op-${name}`), name).toBe(true);
    for (let i = 1; i <= 30; i++) expect(grads.some((b) => b.id === `op-gradient-${i}`), `gradient-${i}`).toBe(true);
    for (const b of OPEN_PROPS_BITS) expect(b.tags).toContain('open-props');
  });

  it('gradient backgrounds fill the frame and drift on a paused loop', () => {
    const g7 = OPEN_PROPS_BITS.find((b) => b.id === 'op-gradient-7')!;
    const out = g7.build({ dim: 0.3, speed: 2 }, ctx);
    expect(out.html).toContain('linear-gradient(to bottom right, #72C6EF, #004E8F)');
    expect(out.html).toContain('class="fill loop opgrad"');
    expect(out.html).toContain('animation-duration:12.0s');
    expect(out.html).toContain('opacity:0.30');
    expect(out.css).toContain('@keyframes rbx-opgrad');
    expect(out.box).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(g7.layout).toBe('fullscreen');
    const still = g7.build({ drift: 0 }, ctx);
    expect(still.html).toContain('background-size:100% 100%');
    expect(still.html).not.toContain('opacity:0.');
  });

  it('animation bits: entrances, exits, one-shots and loops', () => {
    const byId = new Map(OPEN_PROPS_BITS.map((b) => [b.id, b]));
    const fadeIn = byId.get('op-fade-in')!.build({}, ctx);
    expect(fadeIn.html).toContain('animation-name:rbx-op-fade-in');
    expect(fadeIn.html).toContain('opacity:0');
    expect(fadeIn.html).toContain('animation-timing-function:cubic-bezier(.25, 0, .3, 1)');
    expect(fadeIn.css).toContain('@keyframes rbx-op-fade-in{to{opacity:1}}');
    const spring = byId.get('op-slide-in-up')!.build({ easing: 'ease-spring-3', exit: 'slide-out-up' }, ctx);
    expect(spring.html).toContain('animation-timing-function:linear(0, 0.009');
    expect(spring.html).toContain('class="opx"');
    expect(spring.html).toContain('animation-name:rbx-op-slide-out-up');
    expect(spring.html).toContain('animation-delay:calc(var(--exit) + .3s - 0.50s)');
    expect(spring.css).toContain('@keyframes rbx-op-slide-out-up');
    const raw = byId.get('op-slide-in-up')!.build({ easing: 'steps(4)' }, ctx);
    expect(raw.html).toContain('animation-timing-function:steps(4)');
    const bad = byId.get('op-slide-in-up')!.build({ easing: 'url(x)' }, ctx);
    expect(bad.html).toContain('animation-timing-function:cubic-bezier(.25, 0, .3, 1)');
    const bloomDark = byId.get('op-fade-in-bloom')!.build({}, ctx);
    expect(bloomDark.css).toContain('brightness(0.5)');
    const bloomLight = byId.get('op-fade-in-bloom')!.build({}, lightCtx);
    expect(bloomLight.css).toContain('brightness(2)');
    const exit = byId.get('op-fade-out')!.build({}, ctx);
    expect(exit.html).toContain('class="opx"');
    expect(exit.html).toContain('class="a fade"');
    expect(byId.get('op-fade-out')!.props.some((p) => p.name === 'exit')).toBe(false);
    const shake = byId.get('op-shake-x')!.build({}, ctx);
    expect(shake.html).toContain('--d:0.45s');
    const pulse = byId.get('op-pulse')!.build({ duration: 1 }, ctx);
    expect(pulse.html).toContain('class="loop"');
    expect(pulse.html).toContain('animation-duration:1.00s');
    const ping = byId.get('op-ping')!.build({}, ctx);
    expect(ping.html).toContain('class="opping loop"');
    const spin = byId.get('op-spin')!.build({}, ctx);
    expect(spin.html).toContain('class="opspinner loop"');
    expect(spin.html).toContain('animation-timing-function:linear"');
  });

  it('the shadow card demonstrates shadow-1..6 per surface', () => {
    const b = OPEN_PROPS_BITS.find((x) => x.id === 'op-shadow-card')!;
    const dark = b.build({}, ctx);
    expect(dark.html.match(/--shadow-\d/g)?.length).toBe(6);
    expect(dark.html).toContain(scalePx(OPEN_PROPS_SHADOWS.dark['shadow-6']));
    expect(dark.html).toContain('calc(100px * var(--u))');
    expect(dark.html).toContain('One');
    const light = b.build({ surface: 'light', hue: 'blue', rows: ['A', 'B'] }, ctx);
    expect(light.html).toContain(scalePx(OPEN_PROPS_SHADOWS.light['shadow-3']));
    expect(light.html).toContain('#e7f5ff');
    expect(light.html).toContain('>A<');
    expect(light.html).toContain('--shadow-3');
    const auto = b.build({}, lightCtx);
    expect(auto.html).toContain(scalePx(OPEN_PROPS_SHADOWS.light['shadow-1']));
  });
});
