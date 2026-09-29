// The Crimson motion direction system as code.
//
// Two reference guides the user supplied ("Crimson — Video Design Guidelines" and the "Crimson
// Motion Direction Atlas") describe one visual language: a deep-red atmosphere, warm-white
// grotesque type, luminous glass cards, curved ribbon lead-ins, connected diagrams, numbered
// lanes, a presenter beside a rules panel, and motion that arrives, explains, then holds.
// This module turns that into things the product can run: the tokens, the reusable CSS and
// keyframes, a rulebook short enough to sit in the system prompt, and a catalogue of templates
// that `create_motion_graphic` builds. Every template is choreographed with paused CSS
// animations scrubbed by `--elapsed`, so the preview, the frame renderer and the export all
// show the same frame for the same time. No template uses backdrop-filter: glass is layered
// fills and rims, as the guide itself does, because a separately rendered overlay cannot
// blur the footage under it.
import { safeFor } from './layout';

export const CRIMSON = {
  name: 'Crimson',
  tokens: {
    void: '#100607', oxblood: '#1c0000', burgundy: '#250707', panel: '#5d1416', glow: '#941d1f',
    accent: '#d34b55', crimson: '#b32639', rim: '#ffd8d3', white: '#f7f2ee', muted: '#c8a5a3', pink: '#e9879e',
  },
  ease: { out: 'cubic-bezier(.16,1,.3,1)', panel: 'cubic-bezier(.22,1,.36,1)', flow: 'cubic-bezier(.45,0,.15,1)', inout: 'cubic-bezier(.4,0,.2,1)' },
  /** Seconds. Entering title 18–22 frames, panel 10–16, emphasis 4–6, connector 20–30, exit 6–8 at 30 fps. */
  timing: { title: 0.66, panel: 0.53, emphasis: 0.17, connector: 0.9, exit: 0.25, stagger: 0.1, hold: 1.8 },
  type: { hero: 132, heading: 72, body: 36, caption: 46, kicker: 25, row: 44, small: 28 },
  /** Fractions of the frame. */
  safe: { x: 0.05, y: 0.05 },
} as const;

/** The rulebook the model works from, condensed from both guides to what changes decisions. */
export const CRIMSON_RULEBOOK = `CRIMSON MOTION DIRECTION (default guideline)
Look: deep-red atmosphere (near-black ${CRIMSON.tokens.void} / oxblood ${CRIMSON.tokens.oxblood} / burgundy ${CRIMSON.tokens.burgundy}), warm-white type ${CRIMSON.tokens.white}, one bright accent ${CRIMSON.tokens.accent}, pale rims ${CRIMSON.tokens.rim}. Budget ≈75% dark field or footage, 17% information, 8% accent. Footage keeps natural skin; only graphics get the burgundy grade.
Three rules: one idea per frame; motion follows meaning; always leave a hold (title ≥1.5–2 s readable, explanatory card as long as the narration).
Beat: every 5–7 s a meaningful visual decision — build → transform → explain → hold. Never a cut every N seconds regardless of speech.
Type: one grotesque sans (Arial/Helvetica/Inter). Hero 112–144 px, heading 64–88, body 32–44, captions 44–52 at 1080p; tabular figures for numbers; optional serif italic for ONE accent word.
Layouts (pick by the verb of the sentence): compare → comparison; connect → connected-map; progress/list → numbered-lanes or timeline-roadmap; explain a term → teaching-card; personal point → presenter full frame with lower-third; demonstrate software → cursor-demo; statistic → stat-chart; rules while talking → side-panel with the presenter reframed to 55% on the other side; emphasis → editorial-quote or caption-phrase; chapter → ribbon-title; opening → hook-promise.
Layer order: background plate (clean plate when erased) → rear title (behind subject) → subject cutout (roto) → front information card → captions → grain. Keep eyes, mouth and hands clear; graphics sit in the free side of the frame; never text across the face.
Motion: strong ease-out arrivals (${CRIMSON.ease.out}); enter 0.6–0.7 s, panel 0.5 s, rows stagger 100–180 ms, exits 0.25 s; one primary motion and at most one secondary at a time; ONE camera move per graphic (4–6% push-in or a single travel), never while the viewer reads; anticipation → action → settle; overshoot only on playful elements.
Transitions: 1st a clean cut on speech; 2nd a spatial match/reframe (push/zoom keyframes on both clips); 3rd a short blur-push or occluder card for a real chapter change. Cuts and graphic entrances land on music beats (snap_cuts_to_beats). J/L-cut audio across every seam.
Sound: voice leads; music bed 18–24 dB under speech (level_audio), ducked 3–5 dB more under dense phrases; whoosh 150–350 ms leading a panel by 1–2 frames; tick 25–75 ms per row; low impact + air on a chapter change; silence for a reflective line. No hit on every word.
Captions: phrase-based, stable line breaks, 32–42 chars/line, ≥0.8 s per cue, one accent word max, above the bottom 8–12%, never over the mouth.
Prohibited: invented numbers, decorative blobs, blue/mint SaaS look, glow to hide a bad matte, hue cycling, three fonts in one title, letters animated one by one in body text, a camera move that exposes unfilled background.
Acceptance (run_frame_qa + look at the frames): one focal point at phone size; every graphic maps to a spoken point; eyes/mouth/gestures unobstructed; graphics inside safe margins; reading holds sharp; click/response/sound in causal order; voice clear over music.`;

/** Base CSS every Crimson template shares. `--u` scales the 1920-wide design to the canvas. */
export const CRIMSON_BASE_CSS = `
.mgc{position:absolute;inset:0;overflow:hidden;font-family:Inter,Arial,Helvetica,sans-serif;color:var(--white);font-synthesis:none;text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased;
 --void:${CRIMSON.tokens.void};--ox:${CRIMSON.tokens.oxblood};--burg:${CRIMSON.tokens.burgundy};--panel:${CRIMSON.tokens.panel};--glow:${CRIMSON.tokens.glow};--accent:var(--mg-accent,${CRIMSON.tokens.accent});--rim:${CRIMSON.tokens.rim};--white:${CRIMSON.tokens.white};--muted:${CRIMSON.tokens.muted};--pink:${CRIMSON.tokens.pink};
 --eo:${CRIMSON.ease.out};--ep:${CRIMSON.ease.panel};--ef:${CRIMSON.ease.flow};--ei:${CRIMSON.ease.inout};
 --t:calc(var(--elapsed,0) * -1s);--exit:calc(var(--duration,4s) - 0.28s - var(--elapsed,0) * 1s)}
.mgc *{box-sizing:border-box;margin:0}
.mgc .bg{position:absolute;inset:-4%;background:radial-gradient(ellipse 65% 48% at 50% 110%,var(--accent) 0%,var(--glow) 34%,transparent 76%),radial-gradient(ellipse 32% 35% at 101% 91%,var(--accent) 0%,transparent 80%),linear-gradient(180deg,var(--ox) 8%,var(--burg) 59%,var(--panel) 100%)}
.mgc .bg.soft{opacity:.92}
.mgc .vig{position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 calc(210px*var(--u)) calc(36px*var(--u)) #08000065}
.mgc .stage{position:absolute;left:0;right:0;top:calc(50% - 540px*var(--u));height:calc(1080px*var(--u))}
.mgc .glass{position:absolute;border:calc(2px*var(--u)) solid color-mix(in srgb,var(--white) 36%,transparent);border-radius:calc(24px*var(--u));background:linear-gradient(135deg,color-mix(in srgb,var(--white) 9%,transparent) 0%,#ffffff05 44%,color-mix(in srgb,var(--glow) 28%,transparent) 100%),linear-gradient(180deg,color-mix(in srgb,var(--void) 85%,transparent),color-mix(in srgb,var(--void) 92%,transparent));box-shadow:inset 0 1px 1px #fff7,inset 0 0 calc(30px*var(--u)) color-mix(in srgb,var(--white) 7%,transparent),0 0 calc(10px*var(--u)) color-mix(in srgb,var(--white) 28%,transparent),0 calc(20px*var(--u)) calc(70px*var(--u)) #1200004d}
.mgc .glass:before{content:"";position:absolute;inset:calc(6px*var(--u));pointer-events:none;border-radius:calc(18px*var(--u));border:1px solid #fff1}
.mgc .kicker{font-size:calc(${CRIMSON.type.kicker}px*var(--u));letter-spacing:.16em;text-transform:uppercase;opacity:.74;font-weight:500}
.mgc .hero{font-size:calc(${CRIMSON.type.hero}px*var(--u));line-height:.99;font-weight:700;letter-spacing:-.055em}
.mgc .heading{font-size:calc(${CRIMSON.type.heading}px*var(--u));line-height:1.08;font-weight:600;letter-spacing:-.045em}
.mgc .body{font-size:calc(${CRIMSON.type.body}px*var(--u));line-height:1.35;letter-spacing:-.025em}
.mgc .row{font-size:calc(${CRIMSON.type.row}px*var(--u));line-height:1.22;letter-spacing:-.045em;font-weight:500}
.mgc .small{font-size:calc(${CRIMSON.type.small}px*var(--u));line-height:1.3;color:var(--muted);letter-spacing:-.02em}
.mgc .cap{font-size:calc(${CRIMSON.type.caption}px*var(--u));line-height:1.2;font-weight:600;letter-spacing:-.022em;text-shadow:0 2px calc(12px*var(--u)) #000c}
.mgc .num{font-variant-numeric:tabular-nums}
.mgc .accent{color:var(--accent)}
.mgc .onfoot{text-shadow:0 calc(2px*var(--u)) calc(14px*var(--u)) #0009}
.mgc .onglow{text-shadow:0 calc(4px*var(--u)) calc(30px*var(--u)) #000a}
.mgc.light .onfoot{text-shadow:none;background:color-mix(in srgb,var(--void) 90%,transparent);padding:calc(14px*var(--u)) calc(22px*var(--u));border-radius:calc(10px*var(--u))}
.mgc.light .onglow{text-shadow:0 0 calc(10px*var(--u)) var(--void),0 0 calc(34px*var(--u)) var(--void)}
.mgc .serif{font-family:Georgia,'Times New Roman',serif;font-weight:400;font-style:italic;letter-spacing:-.04em}
.mgc .rule{height:calc(2px*var(--u));background:color-mix(in srgb,var(--white) 63%,transparent);transform-origin:left}
.mgc .a{animation-fill-mode:both;animation-play-state:paused;animation-delay:calc(var(--t) + var(--d,0s))}
.mgc .rise{animation-name:mg-rise;animation-duration:.66s;animation-timing-function:var(--eo)}
.mgc .panel-in{animation-name:mg-panel-in;animation-duration:.53s;animation-timing-function:var(--ep)}
.mgc .fade{animation-name:mg-fade;animation-duration:.4s;animation-timing-function:ease-out}
.mgc .grow{animation-name:mg-grow-x;animation-duration:.65s;animation-timing-function:var(--eo)}
.mgc .push{animation-name:mg-push;animation-duration:.6s;animation-timing-function:var(--eo)}
.mgc .draw{stroke-dasharray:1;stroke-dashoffset:1;animation-name:mg-draw;animation-duration:1s;animation-timing-function:var(--ef)}
.mgc .x{animation:mg-out .28s var(--ei) both paused;animation-delay:var(--exit)}
.mgc .cam{animation-fill-mode:both;animation-play-state:paused;animation-delay:var(--t);transform-origin:50% 50%}
.mgc .cam.push-in{animation-name:mg-cam-push;animation-duration:var(--duration,4s);animation-timing-function:linear}
.mgc .words>span{display:inline-block;animation:mg-rise .66s var(--eo) both paused;animation-delay:calc(var(--t) + var(--d,0s))}
@keyframes mg-rise{from{opacity:0;transform:translate3d(0,calc(42px*var(--u)),0);filter:blur(8px)}to{opacity:1;transform:translate3d(0,0,0);filter:blur(0)}}
@keyframes mg-panel-in{from{opacity:0;transform:translate3d(0,calc(18px*var(--u)),0) scale(.86);filter:blur(4px)}to{opacity:1;transform:translate3d(0,0,0) scale(1);filter:blur(0)}}
@keyframes mg-fade{from{opacity:0}to{opacity:var(--alpha,1)}}
@keyframes mg-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes mg-grow-x{from{transform:scaleX(0);opacity:0}to{transform:scaleX(1);opacity:1}}
@keyframes mg-push{from{opacity:0;transform:translateX(calc(80px*var(--u)));filter:blur(7px)}to{opacity:1;transform:translateX(0);filter:blur(0)}}
@keyframes mg-out{from{opacity:1;transform:translateY(0);filter:blur(0)}to{opacity:0;transform:translateY(calc(-16px*var(--u)));filter:blur(5px)}}
@keyframes mg-cam-push{from{transform:scale(1)}to{transform:scale(1.05)}}
@keyframes mg-bar{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes mg-cursor{0%{transform:translate(calc(-420px*var(--u)),calc(260px*var(--u)));opacity:0}12%{opacity:1}70%{transform:translate(calc(-40px*var(--u)),calc(30px*var(--u)))}80%{transform:translate(0,0) scale(.86)}100%{transform:translate(0,0) scale(1)}}
@keyframes mg-ripple{0%{transform:scale(.2);opacity:.9}100%{transform:scale(2.6);opacity:0}}
@keyframes mg-tile-fall{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(calc(60px*var(--u)))}}
@keyframes mg-defocus{from{filter:blur(0)}to{filter:blur(calc(11px*var(--u)))}}
@keyframes mg-travel{from{transform:translateX(0)}to{transform:translateX(var(--travel,0px))}}
@keyframes mg-type{from{width:0}to{width:100%}}
@keyframes mg-count{from{--n:0}to{--n:1}}
`;

export type CrimsonTemplateId =
  | 'hook-promise' | 'ribbon-title' | 'teaching-card' | 'side-panel' | 'connected-map' | 'numbered-lanes'
  | 'editorial-quote' | 'comparison' | 'stat-chart' | 'timeline-roadmap' | 'cursor-demo' | 'chapter-marker'
  | 'caption-phrase' | 'crimson-lower-third' | 'cubes-reveal' | 'countdown' | 'breaking-news';

export type MogrtLayout = 'fullscreen' | 'side-panel-right' | 'side-panel-left' | 'lower-third' | 'behind-subject' | 'pip-footage' | 'top-right' | 'top-left' | 'centre-card';

export type TemplateSpec = {
  id: CrimsonTemplateId;
  label: string;
  /** When the model should reach for it. */
  use: string;
  /** Which params matter. */
  params: string[];
  /** Default length in seconds (the reading hold included). */
  seconds: number;
  /** Where it draws (fraction of the frame) for the given layout on a 16:9 canvas; `buildCrimsonTemplate` maps it onto other canvases. Used by frame QA. */
  box: (layout: MogrtLayout) => { x: number; y: number; width: number; height: number };
  /** True when the graphic wants the footage reframed beside it (layout_clip side-panel). */
  wantsSplit?: boolean;
  /** True when the graphic is a full-frame graphic scene (footage hidden or behind). */
  fullFrame?: boolean;
};

const centre = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
/** The column a footage card in layout_clip's 55% slot leaves free: inside the 5% safe area with a 3% gutter. */
const sideBox = (layout: MogrtLayout) => (layout === 'side-panel-left' ? { x: 0.05, y: 0.1, width: 0.35, height: 0.8 } : { x: 0.6, y: 0.1, width: 0.35, height: 0.8 });
const cornerBox = (layout: MogrtLayout) => (layout === 'top-left' ? { x: 0.05, y: 0.07, width: 0.32, height: 0.18 } : { x: 0.63, y: 0.07, width: 0.32, height: 0.18 });
const lowerBox = () => ({ x: 0.05, y: 0.74, width: 0.5, height: 0.16 });
/** A side panel on a portrait canvas: one card across the lower half, above the bottom 20% of platform UI and clear of the right-hand button rail. */
// px() counts 1920-wide design units: px(120) is 6.25% of the width, px(260) 13.5% — the social safe area.
const portraitPanel = { x: 120 / 1920, y: 0.35, width: 1 - 380 / 1920, height: 0.45 };
const full = () => ({ x: 0, y: 0, width: 1, height: 1 });

export const CRIMSON_TEMPLATES: TemplateSpec[] = [
  { id: 'hook-promise', label: 'Hook promise', use: 'The opening 0–6 s: a 3–7 word promise the video delivers, a support line, a red underline that becomes the next ribbon.', params: ['title', 'subtitle', 'kicker'], seconds: 6, box: () => ({ x: 0.1, y: 0.28, width: 0.8, height: 0.44 }), fullFrame: true },
  { id: 'ribbon-title', label: 'Ribbon chapter title', use: 'A chapter or section change: a luminous curved line draws in, the title appears in word groups, holds, hands off.', params: ['title', 'subtitle', 'kicker'], seconds: 6, box: () => ({ x: 0.12, y: 0.28, width: 0.76, height: 0.44 }), fullFrame: true },
  { id: 'teaching-card', label: 'Teaching card', use: 'Explain a term or a principle: kicker, heading, then 2–4 rows revealed in the order they are spoken; only the current row bright.', params: ['title', 'subtitle', 'kicker', 'rows', 'metric'], seconds: 7, box: (l) => (l === 'centre-card' || l === 'fullscreen' ? centre : sideBox(l)) },
  { id: 'side-panel', label: 'Presenter side panel', use: 'Rules or steps while the presenter keeps talking: reframe the footage to 55% on one side (layout_clip) and stack rows on the other. Rows can be added progressively.', params: ['title', 'subtitle', 'kicker', 'rows'], seconds: 8, box: sideBox, wantsSplit: true },
  { id: 'connected-map', label: 'Connected map', use: 'Relationships: a hub with up to 4 nodes; each connector draws, then its card becomes legible, in narration order.', params: ['title', 'rows', 'kicker'], seconds: 7, box: () => ({ x: 0.06, y: 0.14, width: 0.88, height: 0.76 }), fullFrame: true },
  { id: 'numbered-lanes', label: 'Numbered lanes roadmap', use: 'A list that is a journey: giant numerals on a luminous floor with dotted dividers and reflections; one camera travel to the active lane.', params: ['title', 'subtitle', 'rows', 'activeIndex'], seconds: 7, box: () => ({ x: 0.06, y: 0.14, width: 0.88, height: 0.76 }), fullFrame: true },
  { id: 'editorial-quote', label: 'Editorial quote', use: 'One sharp sentence over a defocused plate, with ONE serif-italic accent word and a red underline. Emphasis, not captions.', params: ['title', 'accentWord', 'subtitle'], seconds: 5, box: () => ({ x: 0.1, y: 0.3, width: 0.8, height: 0.4 }), fullFrame: true },
  { id: 'comparison', label: 'Comparison', use: 'Fair A/B: two matched cards, identical treatment, revealed together; the difference stated in the kicker.', params: ['title', 'subtitle', 'rows', 'kicker'], seconds: 7, box: () => ({ x: 0.06, y: 0.16, width: 0.88, height: 0.7 }), fullFrame: true },
  { id: 'stat-chart', label: 'Stat chart', use: 'A verified statistic: 2–6 bars rising with staggered ease-out and numbers counting to real values; the key bar in accent.', params: ['title', 'subtitle', 'kicker', 'rows', 'values', 'activeIndex'], seconds: 7, box: (l) => (l === 'side-panel-left' || l === 'side-panel-right' ? sideBox(l) : { x: 0.12, y: 0.14, width: 0.76, height: 0.76 }) },
  { id: 'timeline-roadmap', label: 'Timeline', use: 'Dates or stages in order: a horizontal line with markers and labels; the camera travels as the voice moves along it.', params: ['title', 'subtitle', 'rows', 'activeIndex'], seconds: 7, box: () => ({ x: 0.05, y: 0.25, width: 0.9, height: 0.5 }), fullFrame: true },
  { id: 'cursor-demo', label: 'Cursor demo', use: 'Demonstrate a product or an idea becoming a thing: node → tile → interface, a cursor arrives on a curve, clicks, the response expands into the card. Causal order, one settle.', params: ['title', 'subtitle', 'rows', 'kicker'], seconds: 7, box: () => ({ x: 0.15, y: 0.15, width: 0.7, height: 0.7 }), fullFrame: true },
  { id: 'chapter-marker', label: 'Chapter marker', use: 'A small "01 / SECTION" label in a corner while the presenter talks.', params: ['title', 'subtitle', 'kicker'], seconds: 4, box: cornerBox },
  { id: 'caption-phrase', label: 'Caption phrase', use: 'A spoken phrase as a designed caption in the lower zone; one accent word; stable line breaks.', params: ['title', 'accentWord'], seconds: 3, box: () => ({ x: 0.12, y: 0.78, width: 0.76, height: 0.12 }) },
  { id: 'crimson-lower-third', label: 'Crimson lower third', use: 'Name and role bottom-left with a red rule; 3–4 s.', params: ['title', 'subtitle'], seconds: 4, box: lowerBox },
  { id: 'cubes-reveal', label: 'Cubes reveal', use: 'Reveal moment: a grid of tiles falls away top to bottom over ~1.2 s to unveil what is under it (pair with reveal_subject).', params: ['accent'], seconds: 1.4, box: full, fullFrame: true },
  { id: 'countdown', label: 'Countdown', use: 'A numeric countdown or timer with the Crimson type.', params: ['title', 'metric'], seconds: 5, box: () => ({ x: 0.3, y: 0.3, width: 0.4, height: 0.4 }) },
  { id: 'breaking-news', label: 'Breaking news bar', use: 'A full-width lower bar with a red tag and headline for urgent context.', params: ['title', 'subtitle', 'badge'], seconds: 5, box: () => ({ x: 0, y: 0.78, width: 1, height: 0.16 }) },
];

export const templateSpec = (id: string): TemplateSpec | undefined => CRIMSON_TEMPLATES.find((t) => t.id === id);

/** The catalogue as the model reads it. */
export const templateCatalogue = (): string =>
  CRIMSON_TEMPLATES.map((t) => `- ${t.id} (${t.seconds}s${t.wantsSplit ? ', reframes footage beside it' : t.fullFrame ? ', full-frame graphic' : ''}): ${t.use} Params: ${t.params.join(', ')}.`).join('\n');

// ───────────────────────────── builders ─────────────────────────────

export type CrimsonParams = {
  template: string;
  title?: string;
  subtitle?: string;
  kicker?: string;
  rows?: string[];
  values?: number[];
  metric?: string;
  badge?: string;
  accent?: string;
  accentWord?: string;
  activeIndex?: number;
  layout?: MogrtLayout;
  duration?: number;
  cameraMove?: 'none' | 'push-in' | 'travel';
  /** Canvas size the markup is designed for; templates are written for 1920 wide and scale by --u. */
  canvas?: { width: number; height: number };
  /** Per-slot type scale (title, subtitle, kicker, rows) for text the auto-fix found long for its box. */
  fit?: Record<string, number>;
};

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const px = (n: number) => `calc(${n}px * var(--u))`;
const d = (seconds: number) => `--d:${seconds.toFixed(2)}s`;
/** Whole words staggered 100 ms, letters intact. */
const sized = (scale?: number) => (scale && scale < 1 ? `;font-size:${scale}em` : '');
const words = (text: string, from = 0, step: number = CRIMSON.timing.stagger, scale?: number) => text.split(/\s+/).filter(Boolean).map((w, i) => `<span data-slot="title" style="${d(from + i * step)}${sized(scale)}">${esc(w)}&nbsp;</span>`).join('');
const accentWords = (text: string, accentWord: string | undefined, from = 0, scale?: number) => text.split(/\s+/).filter(Boolean).map((w, i) => {
  const hit = accentWord && w.replace(/[^\w]/g, '').toLowerCase() === accentWord.replace(/[^\w]/g, '').toLowerCase();
  return `<span data-slot="title" class="${hit ? 'serif accent' : ''}" style="${d(from + i * CRIMSON.timing.stagger)}${sized(scale)}">${esc(w)}&nbsp;</span>`;
}).join('');
const rowsOf = (rows: string[] | undefined, fallback: string[]) => (rows && rows.length ? rows.slice(0, 6) : fallback);

/** Builds one Crimson template. Returns markup that assumes CRIMSON_BASE_CSS is present. */
export function buildCrimsonTemplate(params: CrimsonParams): { html: string; css: string; box: { x: number; y: number; width: number; height: number }; seconds: number } | null {
  const spec = templateSpec(params.template);
  if (!spec) return null;
  const layout: MogrtLayout = params.layout ?? (spec.wantsSplit ? 'side-panel-right' : spec.fullFrame ? 'fullscreen' : 'centre-card');
  const title = params.title ?? '';
  const subtitle = params.subtitle ?? '';
  const kicker = params.kicker ?? '';
  const fit = params.fit ?? {};
  /** Text for `slot`, tagged for the layout check (graphicCheck.ts) and set smaller when the auto-fix found it long for its box (templateFix.ts). */
  const fitted = (slot: string, text: string) => `<span data-slot="${slot}"${fit[slot] && fit[slot] < 1 ? ` style="font-size:${fit[slot]}em"` : ''}>${esc(text)}</span>`;
  const accent = params.accent && /^#[0-9a-f]{6}$/i.test(params.accent) ? params.accent : CRIMSON.tokens.accent;
  const seconds = params.duration && params.duration > 0 ? params.duration : spec.seconds;
  const side = layout === 'side-panel-left' || layout === 'top-left' ? 'left' : 'right';
  const cam = params.cameraMove === 'push-in' ? 'cam push-in' : '';
  const canvas = params.canvas ?? { width: 1920, height: 1080 };
  const portrait = canvas.height > canvas.width;
  // Templates laid out for 1920×1080 keep that layout in a 16:9 band (.stage) centred on a taller
  // canvas; `band` is its share of the canvas height (1 on 16:9, .316 on 9:16, .5625 on 1:1).
  const band = Math.min(1, (1080 * canvas.width) / 1920 / canvas.height);
  // On a 9:16 canvas the band is inset to the social safe width (clear of the platform's button
  // rail on the right) and its design unit shrinks with it, so a 16:9 layout never reaches the rail.
  const safe = safeFor(canvas.width, canvas.height);
  const inset = canvas.height / canvas.width >= 1.6 ? 1 - safe.left - safe.right : 1;
  const stageBand = band * inset;
  const stage = inset < 1
    ? `<div class="x stage" style="--u:${((canvas.width * inset) / 1920).toFixed(4)};left:${(safe.left * 100).toFixed(3)}%;right:auto;width:${(inset * 100).toFixed(3)}%">`
    : '<div class="x stage">';
  let box = spec.box(layout);
  let banded = false;
  /** An offset from the top or bottom edge: `n` design units on 16:9, `social`% on portrait, the same share of the height as on 16:9 otherwise. */
  const edge = (n: number, social: number) => (portrait ? `${social}%` : band < 1 ? `${Math.round(n / 10.8)}%` : px(n));
  const edgeShare = (n: number, social: number) => (portrait ? social / 100 : Math.round(n / 10.8) / 100);
  /** `b` drawn `bottom` (share of the height) above the foot of a taller canvas, at the band's type size. */
  const above = (b: typeof box, bottom: number) => ({ ...b, y: 1 - bottom - b.height * band, height: b.height * band });
  const wrap = (inner: string, extra = '') => `<div class="mgc" style="--mg-accent:${accent};--u:${(canvas.width / 1920).toFixed(4)}${extra}">${inner}</div>`;
  const bgPlate = spec.fullFrame && layout === 'fullscreen' ? '<div class="bg a fade" style="--alpha:.96"></div><div class="vig"></div>' : '';
  let html = '';
  let css = '';

  switch (spec.id) {
    case 'hook-promise': {
      // A tall frame keeps the right 13% for the platform's like/comment/share rail.
      if (portrait) box = { ...box, width: 1 - 260 / 1920 - box.x };
      html = wrap(`${bgPlate}<div class="${cam} x" style="position:absolute;inset:0"><div style="position:absolute;left:${px(200)};right:${portrait ? px(260) : px(200)};top:${portrait ? '22%' : '30%'}">
        ${kicker ? `<div class="kicker a rise" style="${d(0.1)}">${fitted('kicker', kicker)}</div>` : ''}
        <div class="hero words" style="margin-top:${px(28)}">${words(title, 0.35, undefined, fit.title)}</div>
        <div class="rule a grow" style="width:${px(160)};margin-top:${px(44)};${d(1.3)}"></div>
        ${subtitle ? `<div class="body a rise" style="margin-top:${px(28)};max-width:${px(1200)};color:var(--muted);${d(1.55)}">${fitted('subtitle', subtitle)}</div>` : ''}
      </div></div>`);
      break;
    }
    case 'ribbon-title': {
      if (portrait) box = { ...box, width: Math.min(box.width, 1 - 260 / 1920 - box.x) };
      html = wrap(`${bgPlate}<div class="${cam} x" style="position:absolute;inset:0">
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">
          <path class="a draw" pathLength="1" d="M-40,720 C420,700 620,330 980,420 S1500,760 1980,560" fill="none" stroke-width="26" stroke-linecap="round" style="stroke:var(--accent);filter:blur(15px);opacity:.3;${d(0.3)}"/>
          <path class="a draw" pathLength="1" d="M-40,720 C420,700 620,330 980,420 S1500,760 1980,560" fill="none" stroke-width="14" stroke-linecap="round" style="stroke:var(--glow);${d(0.3)}"/>
          <path class="a draw" pathLength="1" d="M-40,720 C420,700 620,330 980,420 S1500,760 1980,560" fill="none" stroke-width="5" stroke-linecap="round" style="stroke:var(--pink);${d(0.3)}"/>
        </svg>
        <div style="position:absolute;left:${px(280)};right:${portrait ? px(260) : px(190)};top:${portrait ? '26%' : '31%'}">
          ${kicker ? `<div class="kicker a rise" style="${d(0.6)}">${fitted('kicker', kicker)}</div>` : ''}
          <div class="hero words" style="margin-top:${px(24)}">${words(title, 0.85, 0.12, fit.title)}</div>
          ${subtitle ? `<div class="small a rise" style="margin-top:${px(40)};font-size:${px(32)};${d(1.5)}">${fitted('subtitle', subtitle)}</div>` : ''}
        </div></div>`);
      break;
    }
    case 'teaching-card':
    case 'side-panel': {
      const rows = rowsOf(params.rows, ['Contrast — make the important thing unmistakable', 'Hierarchy — a clear first, second and third', 'Balance — leave space for the idea to breathe']);
      const active = Math.min(rows.length - 1, Math.max(0, params.activeIndex ?? rows.length - 1));
      const isSide = spec.id === 'side-panel' || layout.startsWith('side-panel');
      const geometry = isSide
        ? portrait
          ? `left:${px(120)};right:${px(260)};bottom:20%;max-height:45%;padding:${px(48)} ${px(50)}`
          : `${side}:${px(96)};top:${px(110)};width:${px(672)};bottom:${px(110)};padding:${px(48)} ${px(50)}`
        : `left:${px(445)};top:${px(226)};width:${px(1030)};min-height:${px(600)};padding:${px(54)} ${px(62)}`;
      if (isSide && portrait) box = portraitPanel;
      banded = !isSide;
      const list = rows.map((row, i) => {
        const [head, ...rest] = row.split(/\s[—–-]\s/);
        return `<div class="a rise" style="${d(1.05 + i * 0.22)};margin-bottom:${px(22)};opacity:${i === active ? 1 : 0.55}">
          <div style="display:flex;gap:${px(22)};align-items:baseline"><span class="small num" style="min-width:${px(56)};color:var(--accent)">${String(i + 1).padStart(2, '0')}</span><span class="row">${fitted('rows', head)}</span></div>
          ${rest.length ? `<div class="small" style="margin-left:${px(78)};margin-top:${px(4)}">${fitted('rows', rest.join(' — '))}</div>` : ''}</div>`;
      }).join('');
      html = wrap(`${banded ? stage : '<div class="x" style="position:absolute;inset:0">'}<div class="glass a panel-in" style="${geometry};${d(0.05)}">
        <div class="num" style="position:absolute;right:${px(56)};top:${px(40)};font-size:${px(114)};font-weight:700;letter-spacing:-.05em;opacity:.13">${esc(kicker ? kicker.replace(/\D/g, '').slice(0, 2) || '01' : '01')}</div>
        ${kicker ? `<div class="kicker a fade" style="${d(0.45)}">${fitted('kicker', kicker)}</div>` : ''}
        <div class="heading a rise" style="margin-top:${px(12)};margin-bottom:${px(38)};font-size:${px(isSide ? 58 : 65)};${d(0.5)}">${fitted('title', title)}</div>
        ${subtitle ? `<div class="small a rise" style="margin-top:${px(-24)};margin-bottom:${px(34)};${d(0.62)}">${fitted('subtitle', subtitle)}</div>` : ''}
        ${list}
        ${params.metric ? `<div class="hero num a rise" style="font-size:${px(96)};margin-top:${px(12)};${d(1.2 + rows.length * 0.22)}">${esc(params.metric)}</div>` : ''}
      </div></div>`);
      break;
    }
    case 'connected-map': {
      const rows = rowsOf(params.rows, ['Design — shape the meaning', 'Motion — direct the attention', 'Sound — give the movement weight']).slice(0, 4);
      const spots = [{ x: 220, y: 362 }, { x: 1290, y: 362 }, { x: 220, y: 700 }, { x: 1290, y: 700 }];
      const hub = { x: 960, y: 540 };
      const nodes = rows.map((row, i) => {
        const [head, ...rest] = row.split(/\s[—–-]\s/);
        const spot = spots[i];
        return `<div class="glass a panel-in" style="left:${px(spot.x)};top:${px(spot.y - 115)};width:${px(410)};min-height:${px(230)};padding:${px(32)} ${px(36)};${d(1.15 + i * 0.9)}">
          <div class="kicker">0${i + 1}</div><div class="heading" style="font-size:${px(52)};margin-top:${px(16)}">${fitted('rows', head)}</div>${rest.length ? `<div class="small" style="margin-top:${px(6)}">${fitted('rows', rest.join(' '))}</div>` : ''}</div>`;
      }).join('');
      const paths = rows.map((_, i) => {
        const spot = spots[i];
        const tx = spot.x < hub.x ? spot.x + 410 : spot.x;
        const mx = (hub.x + tx) / 2;
        return `<path class="a draw" pathLength="1" d="M${hub.x},${hub.y} C${mx},${hub.y} ${mx},${spot.y} ${tx},${spot.y}" style="${d(0.7 + i * 0.9)}"/><circle class="a fade" cx="${tx}" cy="${spot.y}" r="7" style="fill:var(--white);${d(1.3 + i * 0.9)}"/>`;
      }).join('');
      banded = true;
      html = wrap(`${bgPlate}${stage}
        <div style="position:absolute;left:${px(86)};top:${px(120)}">${kicker ? `<div class="kicker a fade" style="${d(0.1)}">${fitted('kicker', kicker)}</div>` : ''}<div class="heading a rise" style="${d(0.15)}">${fitted('title', title)}</div></div>
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;fill:none;stroke:color-mix(in srgb,var(--white) 67%,transparent);stroke-width:2;stroke-linecap:round">${paths}</svg>
        <div class="glass a panel-in" style="left:${px(hub.x - 95)};top:${px(hub.y - 92)};width:${px(190)};height:${px(185)};border-radius:${px(22)};display:flex;align-items:center;justify-content:center;${d(0.3)}"><div class="heading" style="font-size:${px(40)}">${esc(kicker ? kicker.slice(0, 6) : '●')}</div></div>
        ${nodes}</div>`);
      break;
    }
    case 'numbered-lanes': {
      const rows = rowsOf(params.rows, ['Understand the idea', 'Design the frame', 'Animate with purpose', 'Add sonic detail', 'Refine and deliver']).slice(0, 6);
      const active = Math.min(rows.length - 1, Math.max(0, params.activeIndex ?? 0));
      const laneW = 1480 / rows.length;
      const travel = params.cameraMove === 'travel' && rows.length > 3 ? -(active * laneW - (1480 - laneW) / 2) * 0.5 : 0;
      const lanes = rows.map((row, i) => `<div style="position:relative;width:${px(laneW)};padding:0 ${px(22)};border-left:${px(2)} dotted color-mix(in srgb,var(--white) 48%,transparent);height:100%;${i === active ? 'color:var(--white)' : 'color:var(--muted)'}">
          <div class="small a rise" style="max-width:${px(laneW - 60)};font-size:${px(26)};${d(1.1 + i * 0.12)}${i === active ? ';color:var(--white)' : ''}">${fitted('rows', row)}</div>
          <div class="num a rise" data-deco style="position:absolute;bottom:${px(-18)};font-size:${px(Math.min(254, laneW * 0.86))};line-height:1;font-weight:700;letter-spacing:-.07em;opacity:${i === active ? 1 : 0.42};${d(0.65 + i * 0.12)}">${i + 1}</div>
          <div class="num" data-deco style="position:absolute;top:${px(470)};font-size:${px(Math.min(254, laneW * 0.86))};line-height:1;font-weight:700;letter-spacing:-.07em;transform:scaleY(-1);opacity:.12;filter:blur(${px(5)});mask-image:linear-gradient(0deg,#000,transparent 73%);-webkit-mask-image:linear-gradient(0deg,#000,transparent 73%)">${i + 1}</div>
          <div class="a fade" style="position:absolute;left:${px(-7)};bottom:${px(-7)};width:${px(12)};height:${px(12)};background:var(--white);transform:rotate(45deg);box-shadow:0 0 ${px(14)} var(--white);${d(0.9)}"></div>
        </div>`).join('');
      banded = true;
      html = wrap(`${bgPlate}${stage}
        <div style="position:absolute;left:${px(86)};top:${px(120)}">${kicker ? `<div class="kicker a fade" style="${d(0.1)}">${fitted('kicker', kicker)}</div>` : ''}<div class="heading a rise" style="${d(0.15)}">${fitted('title', title)}</div>${subtitle ? `<div class="small a rise" style="margin-top:${px(10)};max-width:${px(1100)};${d(0.3)}">${fitted('subtitle', subtitle)}</div>` : ''}</div>
        <div class="cam" style="position:absolute;inset:0;--travel:${px(travel)};animation-name:mg-travel;animation-duration:1.1s;animation-timing-function:var(--ei);animation-delay:calc(var(--t) + 1.5s)">
          <div class="rule a grow" style="position:absolute;left:${px(100)};right:${px(100)};top:${px(807)};transform-origin:center;box-shadow:0 0 ${px(10)} ${px(3)} color-mix(in srgb,var(--accent) 42%,transparent);background:var(--white);${d(0.1)}"></div>
          <div style="position:absolute;left:${px(220)};right:${px(220)};top:${px(340)};height:${px(466)};display:flex">${lanes}</div>
        </div></div>`);
      break;
    }
    case 'editorial-quote': {
      if (portrait) box = { ...box, width: 1 - 260 / 1920 - box.x };
      html = wrap(`${spec.fullFrame && layout === 'fullscreen' ? '<div class="a fade" style="position:absolute;inset:0;background:linear-gradient(90deg,color-mix(in srgb,var(--void) 63%,transparent),color-mix(in srgb,var(--void) 25%,transparent)),linear-gradient(0deg,color-mix(in srgb,var(--void) 70%,transparent),transparent 40%);--alpha:1"></div>' : ''}
        <div class="x" style="position:absolute;left:${px(230)};right:${portrait ? px(260) : px(190)};top:${portrait ? '30%' : '34%'}">
          ${kicker ? `<div class="kicker a rise" style="${d(0.1)}">${fitted('kicker', kicker)}</div>` : ''}
          <div class="hero words" style="font-size:${px(112)};margin-top:${px(20)}">${accentWords(title, params.accentWord, 0.3, fit.title)}</div>
          <div class="rule a grow" style="width:${px(220)};margin-top:${px(40)};background:var(--accent);height:${px(4)};${d(1.4)}"></div>
          ${subtitle ? `<div class="small a rise" style="margin-top:${px(26)};font-size:${px(30)};${d(1.6)}">${fitted('subtitle', subtitle)}</div>` : ''}
        </div>`);
      break;
    }
    case 'comparison': {
      const rows = rowsOf(params.rows, ['Before — one long take, no hierarchy', 'After — one idea per frame, a hold']).slice(0, 2);
      const cards = rows.map((row, i) => {
        const [head, ...rest] = row.split(/\s[—–-]\s/);
        return `<div class="glass a panel-in" style="position:relative;flex:1;height:${px(560)};padding:${px(48)} ${px(52)};${d(0.5 + i * 0.12)}">
          <div class="kicker">${i === 0 ? 'A' : 'B'}</div><div class="heading a rise" style="margin-top:${px(18)};font-size:${px(60)};${d(0.9 + i * 0.12)}">${fitted('rows', head)}</div>
          ${rest.length ? `<div class="body a rise" style="margin-top:${px(22)};color:var(--muted);${d(1.15 + i * 0.12)}">${fitted('rows', rest.join(' — '))}</div>` : ''}</div>`;
      }).join('');
      banded = true;
      html = wrap(`${bgPlate}${stage}
        <div style="position:absolute;left:${px(120)};top:${px(120)}">${kicker ? `<div class="kicker a fade" style="${d(0.1)}">${fitted('kicker', kicker)}</div>` : ''}<div class="heading a rise" style="${d(0.15)}">${fitted('title', title)}</div>${subtitle ? `<div class="small a rise" style="margin-top:${px(10)};max-width:${px(1100)};${d(0.3)}">${fitted('subtitle', subtitle)}</div>` : ''}</div>
        <div style="position:absolute;left:${px(120)};right:${px(120)};top:${px(300)};display:flex;gap:${px(48)}">${cards}</div></div>`);
      break;
    }
    case 'stat-chart': {
      const rows = rowsOf(params.rows, ['2022', '2023', '2024', '2025']).slice(0, 6);
      const values = (params.values && params.values.length ? params.values : rows.map((_, i) => 20 + i * 25)).slice(0, rows.length).map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
      const max = Math.max(1, ...values);
      const active = Math.min(rows.length - 1, Math.max(0, params.activeIndex ?? values.indexOf(max)));
      const isSide = layout.startsWith('side-panel');
      const geometry = isSide
        ? portrait ? `left:${px(120)};right:${px(260)};bottom:20%;height:45%` : `${side}:${px(70)};top:${px(110)};width:${px(760)};bottom:${px(110)}`
        : `left:${px(230)};top:${px(150)};width:${px(1460)};height:${px(780)}`;
      if (isSide && portrait) box = portraitPanel;
      banded = !isSide;
      const bars = rows.map((label, i) => {
        const h = Math.round((values[i] / max) * 100);
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:${px(14)}">
          <div class="num a rise" style="font-size:${px(isSide ? 34 : 44)};font-weight:600;${d(0.9 + i * 0.14)};color:${i === active ? 'var(--white)' : 'var(--muted)'}">${esc(params.metric && i === active ? params.metric : String(Math.round(values[i])))}</div>
          <div style="width:${px(isSide ? 72 : 110)};height:${h}%;border-radius:${px(10)} ${px(10)} ${px(4)} ${px(4)};background:${i === active ? 'linear-gradient(180deg,var(--accent),var(--panel))' : 'linear-gradient(180deg,color-mix(in srgb,var(--glow) 67%,transparent),color-mix(in srgb,var(--panel) 67%,transparent))'};box-shadow:${i === active ? `0 0 ${px(24)} color-mix(in srgb,var(--accent) 40%,transparent)` : 'none'};transform-origin:bottom;animation:mg-bar .8s var(--eo) both paused;animation-delay:calc(var(--t) + ${(0.5 + i * 0.14).toFixed(2)}s)"></div>
          <div class="small" style="font-size:${px(isSide ? 24 : 28)};${i === active ? 'color:var(--white)' : ''}">${fitted('rows', label)}</div></div>`;
      }).join('');
      html = wrap(`${banded ? stage : '<div class="x" style="position:absolute;inset:0">'}<div class="glass a panel-in" style="${geometry};padding:${px(48)} ${px(56)};display:flex;flex-direction:column;${d(0.05)}">
        ${kicker ? `<div class="kicker a fade" style="${d(0.4)}">${fitted('kicker', kicker)}</div>` : ''}
        <div class="heading a rise" style="margin-top:${px(10)};font-size:${px(isSide ? 52 : 64)};${d(0.45)}">${fitted('title', title)}</div>
        ${subtitle ? `<div class="small a rise" style="margin-top:${px(8)};${d(0.55)}">${fitted('subtitle', subtitle)}</div>` : ''}
        <div style="flex:1;display:flex;align-items:flex-end;gap:${px(24)};margin-top:${px(40)};border-bottom:${px(2)} solid color-mix(in srgb,var(--white) 40%,transparent);padding-bottom:${px(14)}">${bars}</div>
      </div></div>`);
      break;
    }
    case 'timeline-roadmap': {
      const rows = rowsOf(params.rows, ['2019 — Idea', '2021 — First users', '2023 — Growth', '2025 — Today']).slice(0, 6);
      const active = Math.min(rows.length - 1, Math.max(0, params.activeIndex ?? rows.length - 1));
      // The line spans 260–1660 so the end labels (up to 400 wide, centred on their marks) stay in frame.
      const gap = 1400 / Math.max(1, rows.length - 1);
      const labelW = Math.min(gap * 0.9, 400);
      const travel = params.cameraMove === 'travel' && rows.length > 3 ? -(active * gap - 700) * 0.45 : 0;
      const marks = rows.map((row, i) => {
        const [when, ...rest] = row.split(/\s[—–-]\s/);
        return `<div style="position:absolute;left:${px(260 + i * gap - labelW / 2)};top:${px(500)};width:${px(labelW)};text-align:center;${i === active ? '' : 'opacity:.55'}">
          <div class="a fade" style="width:${px(18)};height:${px(18)};border-radius:50%;background:${i === active ? 'var(--accent)' : 'var(--white)'};margin:0 auto ${px(26)};box-shadow:0 0 ${px(16)} ${i === active ? 'var(--accent)' : 'color-mix(in srgb,var(--accent) 53%,transparent)'};${d(0.6 + i * 0.25)}"></div>
          <div class="heading num a rise" style="font-size:${px(56)};${d(0.75 + i * 0.25)}">${fitted('rows', when)}</div>
          ${rest.length ? `<div class="small a rise" style="margin-top:${px(8)};${d(0.95 + i * 0.25)}">${fitted('rows', rest.join(' '))}</div>` : ''}</div>`;
      }).join('');
      banded = true;
      html = wrap(`${bgPlate}${stage}
        <div style="position:absolute;left:${px(86)};top:${px(120)}">${kicker ? `<div class="kicker a fade" style="${d(0.1)}">${fitted('kicker', kicker)}</div>` : ''}<div class="heading a rise" style="${d(0.15)}">${fitted('title', title)}</div>${subtitle ? `<div class="small a rise" style="margin-top:${px(10)};max-width:${px(1100)};${d(0.3)}">${fitted('subtitle', subtitle)}</div>` : ''}</div>
        <div class="cam" style="position:absolute;inset:0;--travel:${px(travel)};animation-name:mg-travel;animation-duration:1.2s;animation-timing-function:var(--ei);animation-delay:calc(var(--t) + 1.4s)">
          <div class="rule a grow" style="position:absolute;left:${px(260)};width:${px(1400)};top:${px(508)};background:var(--white);box-shadow:0 0 ${px(10)} ${px(3)} color-mix(in srgb,var(--accent) 42%,transparent);${d(0.2)}"></div>${marks}
        </div></div>`);
      break;
    }
    case 'cursor-demo': {
      const rows = rowsOf(params.rows, ['Prompt typed', 'Result ready']).slice(0, 3);
      banded = true;
      html = wrap(`${bgPlate}${stage}
        <div class="a fade" style="position:absolute;left:50%;top:50%;width:${px(26)};height:${px(26)};margin:${px(-13)};border-radius:50%;background:var(--white);box-shadow:0 0 ${px(24)} var(--accent);${d(0.1)};animation-name:mg-fade"></div>
        <div class="glass a panel-in" style="left:${px(560)};top:${px(300)};width:${px(800)};height:${px(480)};padding:${px(44)} ${px(52)};${d(0.75)}">
          ${kicker ? `<div class="kicker a fade" style="${d(1.2)}">${fitted('kicker', kicker)}</div>` : ''}
          <div class="heading a rise" style="margin-top:${px(14)};font-size:${px(56)};${d(1.3)}">${fitted('title', title)}</div>
          <div class="body a rise" style="margin-top:${px(26)};padding:${px(16)} ${px(22)};border-radius:${px(12)};border:1px solid color-mix(in srgb,var(--white) 30%,transparent);background:color-mix(in srgb,var(--void) 67%,transparent);color:var(--muted);${d(1.9)}"><span style="display:inline-block;overflow:hidden;white-space:nowrap;vertical-align:bottom;max-width:100%;animation:mg-type .9s steps(24,end) both paused;animation-delay:calc(var(--t) + 2.3s)">${esc(subtitle || rows[0])}</span></div>
          <div style="display:flex;gap:${px(16)};margin-top:${px(26)}">${(subtitle ? rows : rows.slice(1)).map((row, i) => `<div class="a rise" style="padding:${px(12)} ${px(24)};border-radius:100px;border:1px solid color-mix(in srgb,var(--accent) 32%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--glow) 53%,transparent),color-mix(in srgb,var(--panel) 80%,transparent));font-size:${px(26)};${d(4.1 + i * 0.15)}">${fitted('rows', row)}</div>`).join('')}</div>
        </div>
        <div style="position:absolute;left:${px(1180)};top:${px(700)};animation:mg-cursor 1.7s var(--ei) both paused;animation-delay:calc(var(--t) + 2.6s)">
          <svg width="${px(38)}" height="${px(46)}" viewBox="0 0 19 23"><path style="stroke:var(--void)" d="M1 1 L1 18 L5.5 13.8 L8.3 20.4 L11.2 19.1 L8.4 12.6 L14.4 12.4 Z" fill="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>
        </div>
        <div style="position:absolute;left:${px(1185)};top:${px(705)};width:${px(60)};height:${px(60)};margin:${px(-30)};border-radius:50%;border:${px(3)} solid var(--accent);animation:mg-ripple .7s ease-out both paused;animation-delay:calc(var(--t) + 4.0s)"></div>
      </div>`);
      break;
    }
    case 'chapter-marker': {
      // Off 16:9 the corner sits on the frame's own safe margin (the button rail on 9:16's right).
      const margin = side === 'left' ? safe.left : safe.right;
      const inset = band < 1 ? `${(margin * 100).toFixed(2)}%` : px(96);
      const corner = side === 'left' ? `left:${inset}` : `right:${inset}`;
      if (band < 1) box = { ...box, x: side === 'left' ? safe.left : 1 - safe.right - box.width, y: edgeShare(74, 12), height: box.height * band };
      html = wrap(`<div class="x onfoot" style="position:absolute;top:${edge(74, 12)};${corner};text-align:${side}">
        <div class="kicker a push" style="${d(0.05)}">${esc(kicker || 'CHAPTER')}</div>
        <div class="heading a rise" style="font-size:${px(40)};margin-top:${px(8)};${d(0.2)}">${fitted('title', title)}</div>
        ${subtitle ? `<div class="small a rise" style="font-size:${px(24)};margin-top:${px(4)};${d(0.3)}">${fitted('subtitle', subtitle)}</div>` : ''}
        <div class="rule a grow" style="width:${px(90)};margin-top:${px(12)};background:var(--accent);${side === 'right' ? 'margin-left:auto;transform-origin:right' : ''};${d(0.45)}"></div></div>`);
      break;
    }
    case 'caption-phrase': {
      // 9:16: above the bottom 20% (caption, handle, audio) and clear of the right-hand rail.
      if (band < 1) box = above(portrait ? { ...box, width: 1 - 260 / 1920 - box.x } : box, edgeShare(112, 21));
      html = wrap(`<div class="x" style="position:absolute;left:${px(210)};right:${portrait ? px(260) : px(210)};bottom:${edge(112, 21)};text-align:center">
        <div class="cap words" style="display:inline-block;padding:${px(10)} ${px(26)};border-radius:${px(12)};background:color-mix(in srgb,var(--void) 40%,transparent)">${accentWords(title, params.accentWord, 0.05, fit.title)}</div>
      </div>`);
      break;
    }
    case 'crimson-lower-third': {
      if (band < 1) box = above(box, edgeShare(120, 20));
      html = wrap(`<div class="x onfoot" style="position:absolute;left:${px(96)};bottom:${edge(120, 20)}">
        <div class="rule a grow" style="width:${px(6)};height:${px(120)};position:absolute;left:0;top:${px(4)};background:var(--accent);transform-origin:top;${d(0.05)}"></div>
        <div style="padding-left:${px(30)}">
          <div class="heading a push" style="font-size:${px(58)};${d(0.15)}">${fitted('title', title)}</div>
          ${subtitle ? `<div class="small a push" style="font-size:${px(30)};margin-top:${px(8)};${d(0.3)}">${fitted('subtitle', subtitle)}</div>` : ''}
        </div></div>`);
      break;
    }
    case 'cubes-reveal': {
      const cols = portrait ? 6 : 10;
      const rowsN = portrait ? 12 : 6;
      const tiles: string[] = [];
      for (let r = 0; r < rowsN; r++) for (let c = 0; c < cols; c++) {
        const jitter = ((c * 7 + r * 13) % 5) * 0.03;
        tiles.push(`<div style="animation:mg-tile-fall .32s var(--ei) both paused;animation-delay:calc(var(--t) + ${(0.05 + r * 0.14 + jitter).toFixed(2)}s);background:linear-gradient(135deg,var(--void),var(--void));border:1px solid color-mix(in srgb,var(--white) 12%,transparent)"></div>`);
      }
      html = wrap(`<div style="position:absolute;inset:0;display:grid;grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rowsN},1fr)">${tiles.join('')}</div>`);
      break;
    }
    case 'countdown': {
      const from = Math.max(1, Math.min(99, parseInt(params.metric ?? '5', 10) || 5));
      const digits = Array.from({ length: from }, (_, i) => from - i).map((n, i) => `<div class="hero num a rise onglow" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:${px(360)};${d(i * 1)};animation-name:mg-count-step">${n}</div>`).join('');
      css = `@keyframes mg-count-step{0%{opacity:0;transform:scale(.7)}12%{opacity:1;transform:scale(1)}88%{opacity:1;transform:scale(1.04)}100%{opacity:0;transform:scale(1.1)}}.mgc .a[style*="mg-count-step"]{animation-duration:1s;animation-timing-function:var(--ei)}`;
      banded = true;
      html = wrap(`${stage}${digits}${title ? `<div class="kicker a fade onglow" style="position:absolute;left:0;right:0;bottom:${px(160)};text-align:center;${d(0.1)}">${fitted('title', title)}</div>` : ''}</div>`);
      break;
    }
    case 'breaking-news': {
      if (band < 1) box = above(box, edgeShare(70, 21));
      html = wrap(`<div class="x" style="position:absolute;left:0;right:0;bottom:${edge(70, 21)}">
        <div class="a push" style="display:inline-block;margin-left:${px(60)};padding:${px(10)} ${px(26)};background:var(--accent);color:#fff;font-weight:700;letter-spacing:.14em;font-size:${px(26)};${d(0.05)}">${esc(params.badge || 'BREAKING')}</div>
        <div class="a grow" style="background:linear-gradient(90deg,color-mix(in srgb,var(--void) 95%,transparent),color-mix(in srgb,var(--void) 92%,transparent));border-top:${px(2)} solid color-mix(in srgb,var(--white) 36%,transparent);padding:${px(24)} ${px(60)};transform-origin:left;${d(0.15)}">
          <div class="heading" style="font-size:${px(54)}">${fitted('title', title)}</div>${subtitle ? `<div class="small" style="margin-top:${px(6)}">${fitted('subtitle', subtitle)}</div>` : ''}
        </div></div>`);
      break;
    }
  }
  if (banded) box = { x: inset < 1 ? safe.left + box.x * inset : box.x, width: box.width * inset, y: 0.5 - stageBand / 2 + box.y * stageBand, height: box.height * stageBand };
  return { html, css: CRIMSON_BASE_CSS + css, box, seconds };
}

/** The Crimson guideline note for `create_project_guideline` when the model asks for the pack. */
export const CRIMSON_GUIDELINE_NOTES = CRIMSON_RULEBOOK;
export const CRIMSON_PALETTE = [CRIMSON.tokens.void, CRIMSON.tokens.oxblood, CRIMSON.tokens.panel, CRIMSON.tokens.crimson, CRIMSON.tokens.accent, CRIMSON.tokens.pink, CRIMSON.tokens.white];
