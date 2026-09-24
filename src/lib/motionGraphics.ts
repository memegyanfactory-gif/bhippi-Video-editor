import type { Clip, Comp, Project, Track } from './types';
import type { Box } from './layout';
import { CRIMSON, buildCrimsonTemplate, templateSpec, type MogrtLayout } from './motionGuide';
import { REACT_BITS_TEMPLATE, buildReactBitsGraphic, isReactBitsTemplate, type ReactBitsLayer } from './rbx';
import { brandKitCrimson, brandKitTheme, retintGraphicHtml } from './brandKit/build';
import type { BrandKit } from './brandKit/types';

/** Templates designed on the comp's own canvas (1920 wide landscape / 1080 wide portrait): Crimson and React Bits. */
export const usesCompCanvas = (template: string | undefined | null): boolean => !!template && (!!templateSpec(template) || template === REACT_BITS_TEMPLATE);

export type MotionGraphicTemplateId =
  | 'lower-third'
  | 'kinetic-title'
  | 'stat-callout'
  | 'feature-badge'
  | 'social-callout'
  | 'countdown'
  | 'breaking-news'
  | 'custom';

export type MotionGraphicParams = {
  template?: MotionGraphicTemplateId | string;
  title?: string;
  subtitle?: string;
  /** Small uppercase label above the heading ('PILLAR ONE', '02 / METHOD'). */
  kicker?: string;
  /** List rows for cards, panels, maps, lanes, charts and timelines ('Heading — explanation'). */
  rows?: string[];
  /** Bar values for stat-chart, one per row. */
  values?: number[];
  /** The one word set in serif italic accent (editorial-quote, caption-phrase). */
  accentWord?: string;
  /** Which row / lane / bar is the current one. */
  activeIndex?: number;
  /** Where the graphic sits relative to the footage. */
  layout?: MogrtLayout;
  /** One motivated camera move inside the graphic. */
  cameraMove?: 'none' | 'push-in' | 'travel';
  accentColor?: string;
  metric?: string;
  badge?: string;
  html?: string;
  css?: string;
  js?: string;
  duration?: number;
  /** Canvas the markup is designed for (follows the comp's aspect). */
  canvas?: { width: number; height: number };
  params?: Record<string, string | number | boolean>;
  /** React Bits: the piece to place (template "react-bits"). */
  bit?: string;
  /** React Bits: props for the piece. */
  props?: Record<string, unknown>;
  /** React Bits: a background piece under the graphic. */
  background?: string | ReactBitsLayer;
  /** React Bits: several pieces composed in one graphic. */
  layers?: ReactBitsLayer[];
  /** React Bits: colour theme (crimson default). */
  theme?: string;
  /** The active brand kit: React Bits take its theme unless another theme is named; Crimson templates take its accent and type. */
  brand?: BrandKit | null;
};

export type MotionGraphicBundle = {
  template: string;
  title: string;
  html: string;
  css: string;
  js: string;
  /** Where it draws, fractions of the frame, for frame QA. */
  box?: { x: number; y: number; width: number; height: number };
  /** The template's own length, seconds, when the caller gave none. */
  seconds?: number;
  layout?: MogrtLayout;
};

/** The canvas a comp's motion graphics are designed on: 1920 wide for landscape, 1080 for portrait. */
export function mogrtCanvas(comp: { width: number; height: number }): { width: number; height: number } {
  const width = comp.height > comp.width ? 1080 : 1920;
  return { width, height: Math.round((width * comp.height) / Math.max(1, comp.width)) };
}

/**
 * Where the fixed 1920×1080 canvas of the older templates and custom graphics lands in a frame of
 * `frame`'s shape: fitted and centred, as the export places it (a band across a tall frame).
 */
export function fittedBand(frame: { width: number; height: number }): Box {
  const aspect = frame.width / Math.max(1, frame.height);
  const design = 1920 / 1080;
  if (aspect < design) {
    const height = aspect / design;
    return { x: 0, y: (1 - height) / 2, width: 1, height };
  }
  const width = design / aspect;
  return { x: (1 - width) / 2, y: 0, width, height: 1 };
}

const uid = () => `c_${Math.random().toString(36).slice(2, 9)}`;

/**
 * Curated, high-aesthetic HTML/CSS/GSAP Motion Graphic Templates (MOGRTs).
 * Built with glassmorphism, responsive CSS variables, and deterministic timeline scrubbing.
 */
export function buildMotionGraphic(params: MotionGraphicParams): MotionGraphicBundle {
  const template = (params.template || 'crimson-lower-third').toLowerCase();
  const title = params.title || 'HELIOS MOTION';
  // Copy the caller did not give is left out, never made up.
  const subtitle = params.subtitle ?? '';
  const metric = params.metric ?? '';
  const badge = params.badge ?? '';
  const brand = params.brand ?? null;
  const accent = params.accentColor || (brand ? brandKitCrimson(brand).accent : CRIMSON.tokens.accent);
  // These draw on a fixed 1920×1080 canvas fitted into the comp; their boxes say where in it.
  const band = fittedBand(params.canvas ?? { width: 1920, height: 1080 });
  const inBand = (box: Box): Box => ({ x: band.x + box.x * band.width, y: band.y + box.y * band.height, width: box.width * band.width, height: box.height * band.height });

  if (template === 'custom' && params.html) {
    return {
      template: 'custom',
      title: params.title || 'Custom Motion Graphic',
      html: params.html,
      css: params.css || '',
      js: params.js || '',
      box: band,
    };
  }

  // React Bits: one piece, or a background plus layered pieces, from the 205-piece library.
  if (isReactBitsTemplate(template) && !templateSpec(template)) {
    const useBrandTheme = !!brand && (!params.theme || params.theme === 'brand');
    const built = buildReactBitsGraphic({
      bit: params.bit ?? (template !== REACT_BITS_TEMPLATE ? template : undefined),
      props: params.props, background: params.background, layers: params.layers, theme: params.theme === 'brand' ? undefined : params.theme, accentColor: params.accentColor,
      themeTokens: useBrandTheme ? brandKitTheme(brand) : undefined,
      title: params.title, subtitle: params.subtitle, rows: params.rows, values: params.values, layout: params.layout, duration: params.duration, canvas: params.canvas,
    });
    if ('error' in built) throw new Error(built.error);
    return { template: REACT_BITS_TEMPLATE, title: params.title || built.title, html: built.html, css: built.css, js: built.js, box: built.box, seconds: built.seconds, layout: params.layout };
  }

  // The Crimson system: every template the reference guides describe, choreographed with
  // paused CSS animations scrubbed by --elapsed, so the frame renderer exports them exactly.
  // With a brand kit active the accent and the type stack come from the kit unless an accent is given.
  if (templateSpec(template)) {
    const built = buildCrimsonTemplate({
      template, title: params.title, subtitle: params.subtitle, kicker: params.kicker, rows: params.rows, values: params.values,
      metric: params.metric, badge: params.badge, accent: params.accentColor ?? (brand ? brandKitCrimson(brand).accent : undefined), accentWord: params.accentWord, activeIndex: params.activeIndex,
      layout: params.layout, duration: params.duration, cameraMove: params.cameraMove, canvas: params.canvas,
    });
    if (built) {
      const html = brand ? retintGraphicHtml(built.html, brand) : built.html;
      return { template, title: params.title || templateSpec(template)?.label || template, html, css: built.css, js: '', box: built.box, seconds: built.seconds, layout: params.layout };
    }
  }

  switch (template) {
    case 'kinetic-title': {
      const words = title.split(' ');
      const wordSpans = words.map((w, i) => `<span class="mgt-word" style="--i: ${i};">${w}</span>`).join(' ');
      return {
        template: 'kinetic-title',
        title: `Title: ${title}`,
        box: inBand({ x: 0.25, y: 0.36, width: 0.5, height: 0.28 }),
        html: `
<div class="mgt-container mgt-center">
  <div class="mgt-kinetic-card">
    ${badge ? `<div class="mgt-kicker-tag">${badge}</div>` : ''}
    <h1 class="mgt-kinetic-headline">${wordSpans}</h1>
    ${subtitle ? `<div class="mgt-kinetic-sub">${subtitle}</div>` : ''}
    <div class="mgt-glow-line"></div>
  </div>
</div>`.trim(),
        css: `
.mgt-container {
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
  display: flex;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
}
.mgt-center {
  align-items: center;
  justify-content: center;
}
.mgt-kinetic-card {
  text-align: center;
  padding: 40px 60px;
  background: radial-gradient(circle at center, rgba(15, 23, 42, 0.75) 0%, rgba(15, 23, 42, 0.4) 100%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 24px;
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.6), 0 0 40px -10px ${accent}40;
  animation: mgt-fade-sequence var(--duration, 4s) cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--elapsed, 0) * -1s);
  animation-play-state: paused;
}
.mgt-kicker-tag {
  display: inline-block;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: ${accent};
  background: ${accent}20;
  padding: 6px 16px;
  border-radius: 9999px;
  border: 1px solid ${accent}50;
  margin-bottom: 16px;
}
.mgt-kinetic-headline {
  font-size: 64px;
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1.1;
  margin: 0;
  background: linear-gradient(135deg, #ffffff 40%, ${accent} 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
.mgt-word {
  display: inline-block;
  margin: 0 6px;
  animation: mgt-word-fly 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc((var(--elapsed, 0) - (var(--i, 0) * 0.1)) * -1s);
  animation-play-state: paused;
}
.mgt-kinetic-sub {
  font-size: 22px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.75);
  margin-top: 14px;
  letter-spacing: 0.02em;
}
.mgt-glow-line {
  height: 3px;
  width: 60%;
  margin: 24px auto 0 auto;
  background: linear-gradient(90deg, transparent, ${accent}, transparent);
  border-radius: 9999px;
}
@keyframes mgt-fade-sequence {
  0% { opacity: 0; transform: scale(0.92) translateY(30px); }
  12% { opacity: 1; transform: scale(1) translateY(0); }
  85% { opacity: 1; transform: scale(1) translateY(0); }
  100% { opacity: 0; transform: scale(0.96) translateY(-20px); }
}
@keyframes mgt-word-fly {
  0% { opacity: 0; transform: translateY(40px); }
  100% { opacity: 1; transform: translateY(0); }
}
`.trim(),
        js: `
// GSAP Timeline bound to container
if (window.gsap && container) {
  const tl = gsap.timeline({ paused: true });
  tl.fromTo(container.querySelector('.mgt-kinetic-card'), 
    { opacity: 0, scale: 0.9, y: 30 },
    { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: "power3.out" }
  );
  tl.fromTo(container.querySelectorAll('.mgt-word'),
    { opacity: 0, y: 25 },
    { opacity: 1, y: 0, stagger: 0.08, duration: 0.5, ease: "back.out(1.5)" },
    "-=0.4"
  );
  window.__helios_timeline = tl;
}
`.trim(),
      };
    }

    case 'stat-callout': {
      return {
        template: 'stat-callout',
        title: `Stat: ${title}`,
        box: inBand({ x: 0.776, y: 0.056, width: 0.193, height: 0.178 }),
        html: `
<div class="mgt-container mgt-top-right">
  <div class="mgt-stat-box">
    <div class="mgt-stat-header">
      ${badge ? `<span class="mgt-stat-badge">${badge}</span>` : ''}
      <span class="mgt-stat-pulse"></span>
    </div>
    ${metric ? `<div class="mgt-stat-metric">${metric}</div>` : ''}
    <div class="mgt-stat-title">${title}</div>
    ${subtitle ? `<div class="mgt-stat-sub">${subtitle}</div>` : ''}
    <div class="mgt-progress-track">
      <div class="mgt-progress-fill"></div>
    </div>
  </div>
</div>`.trim(),
        css: `
.mgt-container {
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
  display: flex;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.mgt-top-right {
  align-items: flex-start;
  justify-content: flex-end;
  padding: 60px;
}
.mgt-stat-box {
  width: 320px;
  padding: 24px;
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.5), 0 0 30px -10px ${accent}40;
  animation: mgt-slide-in-right var(--duration, 4s) cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--elapsed, 0) * -1s);
  animation-play-state: paused;
}
.mgt-stat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.mgt-stat-badge {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${accent};
}
.mgt-stat-pulse {
  width: 10px;
  height: 10px;
  background: ${accent};
  border-radius: 50%;
  box-shadow: 0 0 12px ${accent};
}
.mgt-stat-metric {
  font-size: 48px;
  font-weight: 900;
  line-height: 1;
  color: #ffffff;
  letter-spacing: -0.02em;
}
.mgt-stat-title {
  font-size: 16px;
  font-weight: 600;
  color: #f1f5f9;
  margin-top: 8px;
}
.mgt-stat-sub {
  font-size: 13px;
  color: #94a3b8;
  margin-top: 2px;
}
.mgt-progress-track {
  width: 100%;
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  margin-top: 16px;
  overflow: hidden;
}
.mgt-progress-fill {
  height: 100%;
  width: 85%;
  background: linear-gradient(90deg, ${accent}, #a855f7);
  border-radius: 999px;
}
@keyframes mgt-slide-in-right {
  0% { opacity: 0; transform: translateX(60px); }
  15% { opacity: 1; transform: translateX(0); }
  85% { opacity: 1; transform: translateX(0); }
  100% { opacity: 0; transform: translateX(40px); }
}
`.trim(),
        js: ``,
      };
    }

    case 'feature-badge': {
      return {
        template: 'feature-badge',
        title: `Badge: ${title}`,
        box: inBand({ x: 0.031, y: 0.056, width: 0.22, height: 0.041 }),
        html: `
<div class="mgt-container mgt-top-left">
  <div class="mgt-badge-pill">
    <div class="mgt-badge-dot"></div>
    <div class="mgt-badge-title">${title}</div>
    ${subtitle ? `<div class="mgt-badge-divider"></div>
    <div class="mgt-badge-sub">${subtitle}</div>` : ''}
  </div>
</div>`.trim(),
        css: `
.mgt-container {
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
  display: flex;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.mgt-top-left {
  align-items: flex-start;
  justify-content: flex-start;
  padding: 60px;
}
.mgt-badge-pill {
  display: flex;
  align-items: center;
  padding: 12px 24px;
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 9999px;
  box-shadow: 0 15px 35px -5px rgba(0, 0, 0, 0.4), 0 0 20px -5px ${accent}50;
  animation: mgt-pill-entrance var(--duration, 4s) cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--elapsed, 0) * -1s);
  animation-play-state: paused;
}
.mgt-badge-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${accent};
  box-shadow: 0 0 10px ${accent};
  margin-right: 12px;
}
.mgt-badge-title {
  font-size: 15px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.02em;
}
.mgt-badge-divider {
  width: 1px;
  height: 14px;
  background: rgba(255, 255, 255, 0.2);
  margin: 0 12px;
}
.mgt-badge-sub {
  font-size: 14px;
  color: #94a3b8;
}
@keyframes mgt-pill-entrance {
  0% { opacity: 0; transform: translateY(-30px); }
  15% { opacity: 1; transform: translateY(0); }
  85% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-20px); }
}
`.trim(),
        js: ``,
      };
    }

    case 'social-callout': {
      return {
        template: 'social-callout',
        title: `Social: ${title}`,
        box: inBand({ x: 0.78, y: 0.882, width: 0.19, height: 0.062 }),
        html: `
<div class="mgt-container mgt-bottom-right">
  <div class="mgt-social-card">
    <div class="mgt-social-icon">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
    </div>
    <div class="mgt-social-text">
      <div class="mgt-social-title">${title}</div>
      ${subtitle ? `<div class="mgt-social-sub">${subtitle}</div>` : ''}
    </div>
    <div class="mgt-social-btn">SUBSCRIBE</div>
  </div>
</div>`.trim(),
        css: `
.mgt-container {
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
  display: flex;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.mgt-bottom-right {
  align-items: flex-end;
  justify-content: flex-end;
  padding: 60px;
}
.mgt-social-card {
  display: flex;
  align-items: center;
  padding: 16px 22px;
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  box-shadow: 0 20px 40px -10px rgba(0,0,0,0.5);
  animation: mgt-fade-sequence var(--duration, 4s) cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--elapsed, 0) * -1s);
  animation-play-state: paused;
}
.mgt-social-icon {
  color: #ff0033;
  margin-right: 14px;
}
.mgt-social-text {
  margin-right: 20px;
}
.mgt-social-title {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
}
.mgt-social-sub {
  font-size: 12px;
  color: #94a3b8;
}
.mgt-social-btn {
  background: #ff0033;
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 8px 16px;
  border-radius: 999px;
}
@keyframes mgt-fade-sequence {
  0% { opacity: 0; transform: translateY(30px); }
  15% { opacity: 1; transform: translateY(0); }
  85% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(30px); }
}
`.trim(),
        js: ``,
      };
    }

    case 'lower-third':
    default: {
      return {
        template: 'lower-third',
        title: `Lower Third: ${title}`,
        box: inBand({ x: 0.042, y: 0.859, width: 0.25, height: 0.085 }),
        html: `
<div class="mgt-container mgt-bottom-left">
  <div class="mgt-lower-third-card">
    <div class="mgt-accent-bar"></div>
    <div class="mgt-content">
      <div class="mgt-name-row">
        <span class="mgt-name">${title}</span>
        ${badge ? `<span class="mgt-pill">${badge}</span>` : ''}
      </div>
      ${subtitle ? `<div class="mgt-sub-row">${subtitle}</div>` : ''}
    </div>
  </div>
</div>`.trim(),
        css: `
.mgt-container {
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
  display: flex;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
}
.mgt-bottom-left {
  align-items: flex-end;
  justify-content: flex-start;
  padding: 60px 80px;
}
.mgt-lower-third-card {
  display: flex;
  align-items: stretch;
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.6), 0 0 30px -10px ${accent}40;
  animation: mgt-card-slide var(--duration, 4s) cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--elapsed, 0) * -1s);
  animation-play-state: paused;
}
.mgt-accent-bar {
  width: 6px;
  background: linear-gradient(180deg, ${accent} 0%, #a855f7 100%);
  box-shadow: 0 0 15px ${accent};
}
.mgt-content {
  padding: 18px 28px;
}
.mgt-name-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mgt-name {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: #ffffff;
}
.mgt-pill {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${accent};
  background: ${accent}25;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid ${accent}40;
}
.mgt-sub-row {
  font-size: 16px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 4px;
  letter-spacing: 0.01em;
}
@keyframes mgt-card-slide {
  0% { opacity: 0; transform: translateX(-60px) scale(0.95); }
  12% { opacity: 1; transform: translateX(0) scale(1); }
  85% { opacity: 1; transform: translateX(0) scale(1); }
  100% { opacity: 0; transform: translateX(-40px) scale(0.95); }
}
`.trim(),
        js: `
if (window.gsap && container) {
  const card = container.querySelector('.mgt-lower-third-card');
  if (card) {
    const tl = gsap.timeline({ paused: true });
    tl.fromTo(card, { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ease: "power3.out" });
    window.__helios_timeline = tl;
  }
}
`.trim(),
      };
    }
  }
}

/**
 * Creates an HTML/GSAP motion graphic and places it on the timeline as a nested comp
 * (or direct overlay clip), positioned over the video track or in the middle of footage.
 */
export function createMotionGraphicComp(
  project: Project,
  opts: MotionGraphicParams & {
    targetCompId?: string;
    start?: number;
    duration?: number;
    track?: string;
    asNestedComp?: boolean;
  }
): {
  project: Project;
  mogrtComp?: Comp;
  newClipId: string;
  targetCompId: string;
  trackId: string;
  start: number;
  duration: number;
  bundle: MotionGraphicBundle;
} {
  const targetForCanvas = project.comps.find((c) => c.id === (opts.targetCompId || project.activeCompId || project.comps[0]?.id));
  const canvas = opts.canvas ?? (targetForCanvas ? mogrtCanvas(targetForCanvas) : { width: 1920, height: 1080 });
  const preview = buildMotionGraphic({ ...opts, canvas });
  const duration = opts.duration && opts.duration > 0 ? opts.duration : preview.seconds ?? 4.0;
  const bundle = opts.duration && opts.duration > 0 ? preview : buildMotionGraphic({ ...opts, canvas, duration });
  const asNestedComp = opts.asNestedComp ?? true;

  // Find target comp (active comp or first comp)
  const targetCompId = opts.targetCompId || project.activeCompId || project.comps[0]?.id;
  const targetComp = project.comps.find((c) => c.id === targetCompId);
  if (!targetComp) {
    throw new Error(`Target comp not found: ${targetCompId}`);
  }

  // Determine track above existing video (e.g. 'v2', 'v3')
  const videoTracks = targetComp.tracks.filter((t) => t.kind === 'video');
  let targetTrack = opts.track ? targetComp.tracks.find((t) => t.id === opts.track) : null;
  const newTracks = [...targetComp.tracks];

  if (!targetTrack) {
    if (videoTracks.length >= 2) {
      // Use the highest video track (e.g. v2)
      targetTrack = videoTracks[videoTracks.length - 1];
    } else {
      // Create track 'v2' above 'v1'
      const nextId = `v${videoTracks.length + 1}`;
      const newTrack: Track = {
        id: nextId,
        kind: 'video',
        name: `Video ${videoTracks.length + 1}`,
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        targeted: true,
        syncLock: true,
        height: 64,
      };
      newTracks.push(newTrack);
      targetTrack = newTrack;
    }
  }

  // Determine start time: if not given, place in mid of primary video or at playhead
  let start = opts.start ?? 0;
  if (opts.start === undefined) {
    const primaryVideo = targetComp.clips.find(
      (c) => c.enabled && targetComp.tracks.find((t) => t.id === c.trackId)?.kind === 'video'
    );
    if (primaryVideo) {
      // Place in the middle of primary video, or at start + 1.0s if long enough
      if (primaryVideo.duration > duration + 2.0) {
        start = Math.round((primaryVideo.start + 1.5) * 10) / 10;
      } else {
        start = primaryVideo.start;
      }
    }
  }

  const newClipId = uid();
  let mogrtComp: Comp | undefined;
  let updatedTargetComp: Comp;
  let updatedComps = [...project.comps];

  if (asNestedComp) {
    // 1. Create dedicated MOGRT Comp
    const mogrtCompId = `comp_mogrt_${uid()}`;
    const mogrtTrackId = 'v1';
    const innerClipId = uid();

    const innerClip: Clip = {
      id: innerClipId,
      trackId: mogrtTrackId,
      start: 0,
      duration,
      in: 0,
      speed: 1,
      source: {
        type: 'html',
        html: bundle.html,
        css: bundle.css,
        js: bundle.js,
        title: bundle.title,
        template: bundle.template,
        ...(bundle.box ? { box: bundle.box } : {}),
      },
      linkId: null,
      enabled: true,
      name: bundle.title,
      volume: 1,
      transform: { fit: 'fit', x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 },
      effects: { brightness: 0, contrast: 0, saturation: 100, blur: 0, hue: 0, invert: 0, flipH: false, flipV: false },
      label: 'mango',
      groupId: null,
      reverse: false,
      maintainPitch: true,
      hold: null,
      interpolation: 'sampling',
      deinterlace: false,
      adjustment: false,
      mask: null,
      keyframes: { x: [], y: [], scale: [], rotation: [], opacity: [], volume: [] },
      channels: 'stereo',
      enhanceSpeech: false,
      audioType: null,
    };

    mogrtComp = {
      id: mogrtCompId,
      name: `[MOGRT] ${bundle.title}`,
      width: targetComp.width || 1920,
      height: targetComp.height || 1080,
      fps: targetComp.fps || 60,
      tracks: [
        {
          id: mogrtTrackId,
          kind: 'video',
          name: 'Motion Layer',
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
          targeted: true,
          syncLock: true,
          height: 64,
        },
      ],
      clips: [innerClip],
      markers: [],
      transitions: [],
      inPoint: null,
      outPoint: null,
      sourceVideo: null,
      sourceAudio: null,
      folderId: null,
    };

    // 2. Insert clip referencing nested comp into target comp
    const overlayClip: Clip = {
      id: newClipId,
      trackId: targetTrack.id,
      start,
      duration,
      in: 0,
      speed: 1,
      source: {
        type: 'comp',
        compId: mogrtCompId,
      },
      linkId: null,
      enabled: true,
      name: `[MOGRT] ${bundle.title}`,
      volume: 1,
      transform: { fit: 'fit', x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 },
      effects: { brightness: 0, contrast: 0, saturation: 100, blur: 0, hue: 0, invert: 0, flipH: false, flipV: false },
      label: 'mango',
      groupId: null,
      reverse: false,
      maintainPitch: true,
      hold: null,
      interpolation: 'sampling',
      deinterlace: false,
      adjustment: false,
      mask: null,
      keyframes: { x: [], y: [], scale: [], rotation: [], opacity: [], volume: [] },
      channels: 'stereo',
      enhanceSpeech: false,
      audioType: null,
    };

    updatedTargetComp = {
      ...targetComp,
      tracks: newTracks,
      clips: [...targetComp.clips, overlayClip],
    };

    updatedComps = [...updatedComps.filter((c) => c.id !== targetComp.id), updatedTargetComp, mogrtComp];
  } else {
    // Direct HTML clip on target comp track
    const directClip: Clip = {
      id: newClipId,
      trackId: targetTrack.id,
      start,
      duration,
      in: 0,
      speed: 1,
      source: {
        type: 'html',
        html: bundle.html,
        css: bundle.css,
        js: bundle.js,
        title: bundle.title,
        template: bundle.template,
        ...(bundle.box ? { box: bundle.box } : {}),
      },
      linkId: null,
      enabled: true,
      name: bundle.title,
      volume: 1,
      transform: { fit: 'fit', x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 },
      effects: { brightness: 0, contrast: 0, saturation: 100, blur: 0, hue: 0, invert: 0, flipH: false, flipV: false },
      label: 'mango',
      groupId: null,
      reverse: false,
      maintainPitch: true,
      hold: null,
      interpolation: 'sampling',
      deinterlace: false,
      adjustment: false,
      mask: null,
      keyframes: { x: [], y: [], scale: [], rotation: [], opacity: [], volume: [] },
      channels: 'stereo',
      enhanceSpeech: false,
      audioType: null,
    };

    updatedTargetComp = {
      ...targetComp,
      tracks: newTracks,
      clips: [...targetComp.clips, directClip],
    };

    updatedComps = [...updatedComps.filter((c) => c.id !== targetComp.id), updatedTargetComp];
  }

  const updatedProject: Project = {
    ...project,
    comps: updatedComps,
  };

  return {
    project: updatedProject,
    mogrtComp,
    newClipId,
    targetCompId: targetComp.id,
    trackId: targetTrack.id,
    start,
    duration,
    bundle,
  };
}
