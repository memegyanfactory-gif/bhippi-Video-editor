// The brand guideline: a kit's tokens turned into the detailed rules a motion designer works from —
// colour usage, a type scale in pixels, layouts per aspect ratio, scene recipes, and the signature
// moves keyed frame by frame. `guidelineOf(kit)` is what every consumer reads: the one derived here,
// with whatever the AI or the user refined (all a kit keeps) merged over it. The motion engine's `brand-*`
// templates (src/motion/kit/brandTemplates.ts) render `moves` and `layouts` literally.
import type {
  BrandGuideline, BrandKit, BrandLayoutSpec, BrandMove, FrameState, LayoutZone, MoveElement, MoveKey, MoveRole, SceneRecipe, TypeStep,
} from './types';

const FPS = 30;
const now = () => new Date().toISOString();

// Colour helpers are local so this file has no import cycle with build.ts.
const parse = (hex: string) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const luminance = (hex: string) => { const { r, g, b } = parse(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const dark = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex) && luminance(hex) < 0.35;
const token = (kit: BrandKit, role: string) => kit.colors.tokens.find((t) => t.role === role)?.hex;
const mixHex = (a: string, b: string, t: number) => {
  const x = parse(a);
  const y = parse(b);
  const c = (p: number, q: number) => Math.round(p + (q - p) * t).toString(16).padStart(2, '0');
  return `#${c(x.r, y.r)}${c(x.g, y.g)}${c(x.b, y.b)}`;
};
const isHex6 = (v: string | undefined): v is string => !!v && /^#[0-9a-f]{6}$/i.test(v);

/** The full-frame stage: the background colour lifted toward the primary, never the loud accent gradient. */
function stageGradient(c: ReturnType<typeof brandColors>, isDark: boolean): string[] {
  if (!isHex6(c.background) || !isHex6(c.primary)) return [c.background, c.surface];
  return isDark
    ? [c.background, mixHex(c.background, c.primary, 0.22), mixHex(c.background, c.primary, 0.1)]
    : [c.background, mixHex(c.background, c.primary, 0.06), mixHex(c.background, c.surface, 0.5)];
}

/** The kit's colours by role, with the older palette as the fallback. */
export function brandColors(kit: BrandKit) {
  const bg = token(kit, 'background') ?? kit.palette.ink;
  const text = token(kit, 'text') ?? kit.palette.text;
  const accent = token(kit, 'accent') ?? kit.palette.accent;
  return {
    background: bg,
    surface: token(kit, 'surface') ?? kit.palette.surface,
    text,
    muted: token(kit, 'muted') ?? kit.palette.muted,
    primary: token(kit, 'primary') ?? accent,
    accent,
    secondary: token(kit, 'secondary') ?? kit.palette.accentAlt,
  };
}

const f = (seconds: number) => Math.max(1, Math.round(seconds * FPS));

/** How far, how blurred and how springy things move, by the kit's motion intensity. */
function feel(kit: BrandKit) {
  switch (kit.motionGuide.intensity) {
    case 'calm':
      return { distance: 24, blur: 6, overshoot: 0, scaleFrom: 0.98 };
    case 'energetic':
      return { distance: 90, blur: 18, overshoot: 0.06, scaleFrom: 0.86 };
    default:
      return { distance: 44, blur: 12, overshoot: 0.02, scaleFrom: 0.96 };
  }
}

const key = (frame: number, state: FrameState, ease?: string, note?: string): MoveKey => ({ frame, state, ...(ease ? { ease } : {}), ...(note ? { note } : {}) });
const el = (name: string, role: MoveRole, keys: MoveKey[], note?: string): MoveElement => ({ name, role, keys, ...(note ? { note } : {}) });
const length = (elements: MoveElement[]) => Math.max(...elements.flatMap((e) => e.keys.map((k) => k.frame)));
const EASE_IN = 'cubic-bezier(0.55, 0, 1, 0.45)';

function moves(kit: BrandKit): BrandMove[] {
  const m = kit.motionGuide;
  const { distance: d, blur: b, overshoot: os, scaleFrom: s0 } = feel(kit);
  const ease = m.easing;
  const N = f(m.enter);
  const X = f(m.exit);
  const st = f(m.stagger);
  const ws = f(Math.max(0.04, m.stagger * 0.6));

  // A resting entrance for one element starting at `start`.
  const entrance = (start: number, from: FrameState, frames = N): MoveKey[] => {
    const keys = [key(start, { opacity: 0, ...from }, ease), key(start + Math.round(frames * 0.45), { opacity: 1 })];
    if (os > 0) keys.push(key(start + Math.round(frames * 0.78), { y: from.y ? -from.y * 0.08 : 0, scale: 1 + os }));
    keys.push(key(start + frames, { opacity: 1, x: 0, y: 0, scale: 1, blur: 0, rotate: 0 }));
    return keys;
  };
  const exit = (start: number, to: FrameState, frames = X): MoveKey[] => [key(start, { opacity: 1, x: 0, y: 0, scale: 1, blur: 0 }, EASE_IN), key(start + frames, { opacity: 0, ...to })];
  const clipIn = (start: number, frames = N): MoveKey[] => [key(start, { clip: 0 }, ease), key(start + frames, { clip: 1 })];

  const titleIn: MoveElement[] = [
    el('Kicker', 'kicker', [key(0, { clip: 0, opacity: 1, tracking: 40 }, ease), key(Math.round(N * 0.8), { clip: 1, tracking: 0 })], 'small label above the headline, wipes in from its leading edge'),
    el('Headline', 'headline', entrance(Math.round(st * 0.5), { y: d, blur: b, scale: s0 }), 'word by word when longer than two words (see word-cascade)'),
    el('Accent bar', 'accent-bar', clipIn(st, Math.round(N * 0.9)), 'accent colour, under the headline'),
    el('Subhead', 'subhead', entrance(st * 2, { y: Math.round(d * 0.6), blur: Math.round(b * 0.7) })),
  ];
  const words = [0, 1, 2].map((i) => el(`Word ${i + 1}`, 'headline', entrance(i * ws, { y: Math.round(d * 0.8), blur: b, scale: s0 })));
  const titleOut: MoveElement[] = [
    el('Headline', 'headline', exit(0, { y: -Math.round(d * 0.5), blur: Math.round(b * 0.8) })),
    el('Subhead', 'subhead', exit(0, { y: -Math.round(d * 0.4), blur: Math.round(b * 0.6) })),
    el('Accent bar', 'accent-bar', [key(0, { clip: 1 }, EASE_IN), key(X, { clip: 0 })]),
  ];
  const lowerThirdIn: MoveElement[] = [
    el('Panel', 'panel', clipIn(0), 'surface colour at 92% opacity, brand corner radius'),
    el('Accent bar', 'accent-bar', clipIn(0, Math.round(N * 0.6)), 'accent, on the leading edge of the panel'),
    el('Name', 'headline', entrance(st, { x: -Math.round(d * 0.6), blur: Math.round(b * 0.6) })),
    el('Role', 'subhead', entrance(st * 2, { x: -Math.round(d * 0.4), blur: Math.round(b * 0.5) })),
  ];
  const lowerThirdOut: MoveElement[] = [
    el('Name', 'headline', exit(0, { x: -Math.round(d * 0.4) })),
    el('Role', 'subhead', exit(0, { x: -Math.round(d * 0.3) })),
    el('Panel', 'panel', [key(Math.round(X * 0.3), { clip: 1 }, EASE_IN), key(X + Math.round(X * 0.3), { clip: 0 })]),
  ];
  const statCount: MoveElement[] = [
    el('Number', 'number', [...entrance(0, { scale: s0, blur: b }), key(f(1.2), { opacity: 1 }, undefined, 'the value counts up from 0 over frames 0–' + f(1.2))], 'counts up with the brand ease'),
    el('Accent bar', 'accent-bar', clipIn(st)),
    el('Label', 'label', entrance(st * 2, { y: Math.round(d * 0.5), blur: Math.round(b * 0.6) })),
  ];
  const emphasis: MoveElement[] = [
    el('Accent word', 'headline', [key(0, { scale: 1 }, ease), key(Math.round(f(0.5) * 0.4), { scale: 1 + Math.max(0.04, os * 1.4) }), key(f(0.5), { scale: 1 })], 'the one word that matters turns accent colour on frame 0'),
  ];
  const logoSting: MoveElement[] = [
    el('Background', 'background', [key(0, { opacity: 0, scale: 1.04 }, ease), key(N, { opacity: 1, scale: 1 })]),
    el('Logo', 'logo', entrance(Math.round(st * 0.5), { scale: kit.motionGuide.intensity === 'calm' ? 0.94 : 0.8, blur: b })),
    el('Wordmark', 'headline', clipIn(st * 2, Math.round(N * 0.9))),
    el('Tagline', 'subhead', entrance(st * 3, { y: Math.round(d * 0.4) })),
  ];
  const kind = m.transitions.find((t) => t !== 'cut') ?? 'dissolve';
  const T = f(Math.max(0.35, m.enter * 0.8));
  const transition: MoveElement[] = kind.includes('push') || kind.includes('slide')
    ? [el('Outgoing shot', 'outgoing', [key(0, { x: 0 }, ease), key(T, { x: -560, opacity: 0.4 })]), el('Incoming shot', 'incoming', [key(0, { x: 1920 }, ease), key(T, { x: 0 })])]
    : kind.includes('zoom') || kind.includes('punch')
      ? [el('Outgoing shot', 'outgoing', [key(0, { scale: 1, blur: 0 }, EASE_IN), key(Math.round(T * 0.5), { scale: 1.15, blur: 20, opacity: 0 })]), el('Incoming shot', 'incoming', [key(Math.round(T * 0.5), { scale: 0.9, blur: 16, opacity: 0 }, ease), key(T, { scale: 1, blur: 0, opacity: 1 })])]
      : kind.includes('wipe') || kind.includes('occluder')
        ? [el('Wipe panel', 'panel', [key(0, { clip: 0 }, ease), key(Math.round(T * 0.5), { clip: 1 }), key(T, { clip: 0 })], 'accent colour panel crosses the frame; the cut happens under it'), el('Incoming shot', 'incoming', [key(Math.round(T * 0.5), { opacity: 1 })])]
        : [el('Outgoing shot', 'outgoing', [key(0, { opacity: 1 }, ease), key(T, { opacity: 0 })]), el('Incoming shot', 'incoming', [key(0, { opacity: 0 }, ease), key(T, { opacity: 1 })])];
  const endCard: MoveElement[] = [
    el('Panel', 'panel', entrance(0, { scale: s0 })),
    el('Headline', 'headline', entrance(st, { y: d, blur: b })),
    el('Call to action', 'cta', entrance(st * 3, { scale: 0.9 }), 'accent fill, text colour chosen for contrast'),
    el('Logo', 'logo', entrance(st * 4, { opacity: 0, scale: 0.9 })),
  ];
  const caption: MoveElement[] = [el('Caption', 'caption', entrance(0, { scale: kit.motionGuide.intensity === 'calm' ? 0.97 : 0.92, y: 8 }, f(Math.min(0.25, m.enter * 0.5))))];
  const drift: MoveElement[] = [el('Background', 'background', [key(0, { scale: 1, x: 0 }, 'linear'), key(f(Math.max(4, m.hold * 3)), { scale: 1.06, x: -20 })], 'slow constant drift so a held card never freezes')];

  const move = (id: string, name: string, use: string, description: string, elements: MoveElement[]): BrandMove => ({ id, name, use, description, fps: FPS, frames: length(elements), elements });
  const sec = (frames: number) => `${(frames / FPS).toFixed(2)} s`;
  return [
    move('title-in', 'Title in', 'Every title, chapter and hook headline.', `Kicker wipes in (f0–${Math.round(N * 0.8)}); headline rises ${d}px with ${b}px blur and lands at f${Math.round(st * 0.5) + N}${os ? ` with a ${Math.round(os * 100)}% overshoot` : ''}; accent bar draws from f${st}; subhead follows at f${st * 2}. Ease ${ease}.`, titleIn),
    move('word-cascade', 'Word cascade', 'Headlines longer than two words and spoken phrases (times from the transcript).', `Each word enters like the headline, ${ws} frames (${sec(ws)}) after the one before.`, words),
    move('title-out', 'Title out', 'Leaving any title before the next beat.', `Everything leaves together in ${X} frames (${sec(X)}), rising ${Math.round(d * 0.5)}px and blurring, on an ease-in.`, titleOut),
    move('lower-third-in', 'Lower third in', 'Names, roles and sources.', `Panel wipes open from its leading edge over ${N} frames; name slides in from the left at f${st}, role at f${st * 2}.`, lowerThirdIn),
    move('lower-third-out', 'Lower third out', 'Leaving a lower third.', `Text leaves first, the panel closes ${Math.round(X * 0.3)} frames later.`, lowerThirdOut),
    move('stat-count', 'Stat count', 'Any real number or percentage.', `Number scales up from ${s0} and counts from 0 over ${f(1.2)} frames; label arrives at f${st * 2}.`, statCount),
    move('emphasis', 'Emphasis', 'The key word of a phrase.', 'The word turns accent colour and pulses once.', emphasis),
    move('logo-sting', 'Logo sting', 'Intros, outros and section idents.', `Background fades up, logo lands at f${Math.round(st * 0.5) + N}, wordmark wipes in, tagline last.`, logoSting),
    move('transition', `Transition (${kind})`, 'Between beats when a cut is not enough.', `${kind} over ${T} frames (${sec(T)}).`, transition),
    move('end-card', 'End card', 'The last three seconds.', `Panel, headline, call to action (f${st * 3}) and logo (f${st * 4}) arrive in order, then hold.`, endCard),
    move('caption-pop', 'Caption pop', 'Every caption line.', 'Each caption line scales in quickly and does not move again.', caption),
    move('background-drift', 'Background drift', 'Under any held card.', 'The background slowly scales 6% and drifts left for the length of the hold.', drift),
  ];
}

// ── layouts ──────────────────────────────────────────────────────────────────

const zone = (role: string, name: string, x: number, y: number, w: number, h: number, align: LayoutZone['align'], type?: LayoutZone['type'], notes?: string): LayoutZone => ({
  role, name, x: +x.toFixed(3), y: +y.toFixed(3), w: +w.toFixed(3), h: +h.toFixed(3), align, ...(type ? { type } : {}), ...(notes ? { notes } : {}),
});

function layouts(kit: BrandKit): BrandLayoutSpec[] {
  const m = Math.max(0.03, Math.min(0.12, kit.layout.safeMargin));
  const out: BrandLayoutSpec[] = [];
  const aspects: BrandLayoutSpec['aspect'][] = ['16:9', '9:16'];
  if (kit.layout.aspects.some((a) => a.includes('1:1'))) aspects.push('1:1');
  const logo = (tall: boolean): LayoutZone => {
    const w = tall ? 0.16 : 0.08;
    const h = tall ? 0.05 : 0.07;
    const corner = kit.layout.logoBug;
    const x = corner.endsWith('left') ? m : corner === 'center' ? 0.5 - w / 2 : 1 - m - w;
    const y = corner.startsWith('top') ? m : corner === 'center' ? 0.5 - h / 2 : 1 - m - h;
    return zone('logo', 'Logo bug', x, y, w, h, corner.endsWith('left') ? 'left' : corner === 'center' ? 'center' : 'right', undefined, `clear space ${kit.logos[0]?.clearSpace ?? 0.5}× the mark height`);
  };
  const captions = (tall: boolean): LayoutZone => {
    const place = kit.layout.captions;
    const h = tall ? 0.12 : 0.14;
    const y = place === 'top-center' ? m + 0.04 : place === 'center' ? 0.5 - h / 2 : tall ? 0.68 : 1 - m - h;
    return zone('captions', 'Captions', m + (tall ? 0.02 : 0.1), y, 1 - 2 * m - (tall ? 0.04 : 0.2), h, 'center', 'caption');
  };
  for (const aspect of aspects) {
    const tall = aspect === '9:16';
    const tag = aspect.replace(':', 'x');
    const left = tall ? m + 0.02 : m + 0.04;
    const width = 1 - left * 2;
    out.push({
      id: `title-${tag}`, name: `Title card ${aspect}`, aspect, use: 'Hooks, chapters, section titles.',
      zones: [
        zone('kicker', 'Kicker', left, tall ? 0.34 : 0.3, width, 0.04, 'center', 'label'),
        zone('headline', 'Headline', left, tall ? 0.38 : 0.35, width, tall ? 0.16 : 0.2, 'center', 'display', 'max 4 words per line'),
        zone('accent-bar', 'Accent bar', 0.5 - 0.06, tall ? 0.55 : 0.57, 0.12, 0.006, 'center'),
        zone('subhead', 'Subhead', left + width * 0.1, tall ? 0.58 : 0.6, width * 0.8, 0.08, 'center', 'subhead'),
        logo(tall),
      ],
    });
    const ltW = tall ? 1 - 2 * m : 0.42;
    const ltX = kit.layout.lowerThird === 'bottom-right' ? 1 - m - ltW : kit.layout.lowerThird === 'bottom-center' ? 0.5 - ltW / 2 : m;
    const ltY = tall ? 0.72 : 1 - m - 0.16;
    out.push({
      id: `lower-third-${tag}`, name: `Lower third ${aspect}`, aspect, use: 'Names, roles, sources while someone talks.',
      zones: [
        zone('panel', 'Panel', ltX, ltY, ltW, tall ? 0.1 : 0.14, 'left', undefined, 'surface colour, brand radius'),
        zone('accent-bar', 'Accent bar', ltX, ltY, 0.006, tall ? 0.1 : 0.14, 'left'),
        zone('headline', 'Name', ltX + 0.025, ltY + 0.02, ltW - 0.05, tall ? 0.04 : 0.06, 'left', 'heading'),
        zone('subhead', 'Role', ltX + 0.025, ltY + (tall ? 0.06 : 0.085), ltW - 0.05, 0.035, 'left', 'label'),
      ],
    });
    out.push({
      id: `stat-${tag}`, name: `Stat ${aspect}`, aspect, use: 'One real number with its label.',
      zones: [
        zone('number', 'Number', left, tall ? 0.34 : 0.28, width, tall ? 0.16 : 0.26, 'center', 'display', 'accent colour or text colour with an accent bar'),
        zone('accent-bar', 'Accent bar', 0.5 - 0.05, tall ? 0.52 : 0.57, 0.1, 0.006, 'center'),
        zone('label', 'Label', left + width * 0.15, tall ? 0.55 : 0.6, width * 0.7, 0.06, 'center', 'subhead'),
      ],
    });
    out.push({
      id: `split-${tag}`, name: `Split ${aspect}`, aspect, use: 'Presenter on one side, the teaching panel on the other.',
      zones: tall
        ? [zone('presenter', 'Presenter', 0, 0.45, 1, 0.55, 'center', undefined, 'reframe the footage to the lower half'), zone('panel', 'Panel', m, m + 0.04, 1 - 2 * m, 0.36, 'left'), zone('headline', 'Panel title', m + 0.04, m + 0.08, 1 - 2 * m - 0.08, 0.06, 'left', 'heading'), zone('body', 'Points', m + 0.04, m + 0.16, 1 - 2 * m - 0.08, 0.22, 'left', 'body')]
        : [zone('presenter', 'Presenter', 0.45, 0, 0.55, 1, 'center', undefined, 'reframe the footage to the right 55%'), zone('panel', 'Panel', m, m + 0.08, 0.4, 1 - 2 * m - 0.16, 'left'), zone('headline', 'Panel title', m + 0.03, m + 0.14, 0.34, 0.08, 'left', 'heading'), zone('body', 'Points', m + 0.03, m + 0.26, 0.34, 0.5, 'left', 'body')],
    });
    out.push({
      id: `end-card-${tag}`, name: `End card ${aspect}`, aspect, use: 'The last three seconds.',
      zones: [
        zone('panel', 'Panel', m, m, 1 - 2 * m, 1 - 2 * m, 'center'),
        zone('headline', 'Headline', left, tall ? 0.36 : 0.32, width, 0.14, 'center', 'heading'),
        zone('cta', 'Call to action', 0.5 - (tall ? 0.28 : 0.14), tall ? 0.53 : 0.52, tall ? 0.56 : 0.28, tall ? 0.06 : 0.1, 'center', 'label'),
        zone('logo', 'Logo', 0.5 - 0.08, tall ? 0.66 : 0.68, 0.16, 0.08, 'center'),
      ],
    });
    out.push({ id: `captions-${tag}`, name: `Captions and logo ${aspect}`, aspect, use: 'Where captions and the logo bug sit on every shot.', zones: [captions(tall), logo(tall)] });
  }
  return out;
}

// ── type scale ───────────────────────────────────────────────────────────────

const tracking = (spacing: string) => {
  const em = parseFloat(spacing);
  return Number.isFinite(em) ? Math.round(em * (spacing.includes('em') ? 100 : 1)) : 0;
};

function typeScale(kit: BrandKit, c: ReturnType<typeof brandColors>): TypeStep[] {
  const t = kit.typography;
  const s = t.scale;
  const px = (pct: number) => Math.round((pct / 100) * 1080);
  const step = (role: TypeStep['role'], face: BrandKit['typography']['display'], pct: number, lineHeight: number, color: string, maxWordsPerLine: number): TypeStep => ({
    role, family: face.family, weight: face.weight, size: px(pct), lineHeight, tracking: tracking(face.letterSpacing), transform: face.transform, color, maxWordsPerLine,
  });
  return [
    step('display', t.display, s.hook, Math.min(1.05, t.lineHeight), c.text, 4),
    step('heading', t.heading, s.title, Math.min(1.12, t.lineHeight), c.text, 6),
    step('subhead', t.heading, s.subtitle, t.lineHeight, c.muted, 9),
    step('body', t.body, s.body, t.lineHeight, c.text, 14),
    step('caption', t.caption, s.caption, t.lineHeight, c.text, 8),
    { ...step('label', t.caption, s.label, 1.2, c.accent, 4), size: Math.max(24, px(s.label)), tracking: Math.max(8, tracking(t.caption.letterSpacing)), transform: 'uppercase', weight: Math.max(600, t.caption.weight) },
  ];
}

// ── recipes ──────────────────────────────────────────────────────────────────

function recipes(kit: BrandKit, c: ReturnType<typeof brandColors>, gradient: string[]): SceneRecipe[] {
  const h = kit.motionGuide.hold;
  const bg = (note: string): SceneRecipe['background'] => ({ kind: 'gradient', colors: gradient, note });
  return [
    { id: 'hook', name: 'Hook', use: 'The first two seconds.', layout: 'title-16x9', background: bg(kit.social.intro || 'the brand gradient, or the strongest shot under a 40% background-colour wash'), moves: ['word-cascade', 'emphasis'], template: 'brand-title', copy: 'One promise, 3–6 words, one accent word.', hold: Math.max(0.8, h * 0.6) },
    { id: 'title', name: 'Title / chapter', use: 'Section starts.', layout: 'title-16x9', background: bg('brand gradient with a slow drift'), moves: ['title-in', 'background-drift', 'title-out'], template: 'brand-title', copy: 'Kicker (chapter number), headline, optional subhead.', hold: h },
    { id: 'lower-third', name: 'Lower third', use: 'Introduce a person, a source or a place.', layout: 'lower-third-16x9', background: { kind: 'footage', colors: [c.surface], note: 'over the talking shot' }, moves: ['lower-third-in', 'lower-third-out'], template: 'brand-lower-third', copy: 'Name in heading, role in label.', hold: Math.max(2.5, h * 1.5) },
    { id: 'stat', name: 'Stat', use: 'Any real number.', layout: 'stat-16x9', background: bg('brand gradient'), moves: ['stat-count', 'title-out'], template: 'brand-stat', copy: 'The number, and a label of 3–7 words. Real numbers only.', hold: h },
    { id: 'explainer', name: 'Explainer panel', use: 'Rules, steps or definitions while the presenter talks.', layout: 'split-16x9', background: { kind: 'footage', colors: [c.surface], note: 'presenter reframed to the other side' }, moves: ['lower-third-in', 'word-cascade'], template: 'brand-panel', copy: 'Title plus up to 4 short points.', hold: h * 2 },
    { id: 'quote', name: 'Quote / emphasis', use: 'A line worth reading.', layout: 'title-16x9', background: bg('brand background, no pattern'), moves: ['word-cascade', 'emphasis', 'title-out'], template: 'brand-title', copy: 'Up to 12 words; the accent word in accent colour.', hold: h * 1.5 },
    { id: 'transition', name: 'Transition', use: 'Between beats.', layout: 'captions-16x9', background: { kind: 'solid', colors: [c.accent], note: 'the wipe panel colour' }, moves: ['transition'], template: 'brand-transition', copy: 'None.', hold: 0 },
    { id: 'logo-sting', name: 'Logo sting', use: 'Intro and outro idents.', layout: 'end-card-16x9', background: bg('brand gradient'), moves: ['logo-sting'], template: 'brand-logo-sting', copy: 'Brand name and tagline.', hold: 1 },
    { id: 'end-card', name: 'End card', use: 'Last three seconds.', layout: 'end-card-16x9', background: bg(kit.social.outro || 'brand gradient'), moves: ['end-card'], template: 'brand-end-card', copy: kit.social.endCard.join(' → ') || 'Headline, call to action, logo.', hold: 2.5 },
  ];
}

// ── the guideline ────────────────────────────────────────────────────────────

export function deriveGuideline(kit: BrandKit): BrandGuideline {
  const c = brandColors(kit);
  const stageDark = dark(c.background);
  const gradient = stageGradient(c, stageDark);
  const brandGradient = kit.colors.gradients[0]?.stops?.length ? kit.colors.gradients[0].stops : [c.primary, c.accent];
  const m = kit.motionGuide;
  const fl = feel(kit);
  return {
    version: 1,
    source: 'derived',
    updatedAt: now(),
    summary: `${kit.name}: ${stageDark ? 'dark' : 'light'} stage in ${c.background} with ${c.surface} surfaces, ${c.text} type and ${c.accent} as the single accent. ${kit.typography.display.family} ${kit.typography.display.weight} headlines, ${kit.typography.body.family} body. ${m.intensity} motion: things enter in ${m.enter}s travelling ${fl.distance}px with ${fl.blur}px blur on ${m.easing}, leave in ${m.exit}s, hold ${m.hold}s, stagger ${m.stagger}s.`,
    color: {
      ratio: '60% background · 30% surface and text · 10% accent',
      stage: { tone: stageDark ? 'dark' : 'light', background: c.background, gradient, note: `${stageDark ? 'Every full-frame card sits on the background colour lifted toward the primary; never on pure black unless that is the background.' : 'A light stage: backgrounds are the background colour; text and shapes use the text colour; the accent marks one thing.'} The brand gradient (${brandGradient.join(' → ')}) is for accent shapes, bars and CTA fills, never the whole frame.` },
      roles: [
        { role: 'background', hex: c.background, use: 'full-frame stages, end cards' },
        { role: 'surface', hex: c.surface, use: 'panels, lower thirds, cards' },
        { role: 'text', hex: c.text, use: 'all headline and body type' },
        { role: 'muted', hex: c.muted, use: 'subheads, labels, secondary lines' },
        { role: 'primary', hex: c.primary, use: 'large brand shapes, gradients' },
        { role: 'accent', hex: c.accent, use: 'accent bars, the emphasised word, calls to action — one per frame' },
        { role: 'secondary', hex: c.secondary, use: 'charts and second series only' },
      ],
      rules: [...kit.colors.rules, 'Only brand colours appear in graphics; footage keeps its own colour but is graded to the brand grade.', 'The accent marks one thing per frame.'],
    },
    typeScale: typeScale(kit, c),
    motion: {
      principles: [...m.principles, `Nothing moves linearly except slow background drift.`, `Entrances use ${m.easing}; exits are faster (${m.exit}s) on an ease-in.`, `Elements of one graphic arrive ${m.stagger}s apart in reading order: kicker, headline, accent, subhead.`],
      fps: FPS,
      easing: { enter: m.easing, exit: EASE_IN, move: m.easing },
      timing: { enter: m.enter, exit: m.exit, hold: m.hold, stagger: m.stagger, wordStagger: +(Math.max(0.04, m.stagger * 0.6)).toFixed(3) },
      distance: fl.distance,
      blur: fl.blur,
      overshoot: fl.overshoot,
    },
    moves: moves(kit),
    layouts: layouts(kit),
    recipes: recipes(kit, c, gradient),
    dos: [...kit.layout.rules, ...kit.typography.rules, `Keep everything inside the ${Math.round(kit.layout.safeMargin * 100)}% safe margin.`, 'Give every graphic its reading hold before it leaves.'].filter(Boolean),
    donts: [...(kit.logos[0]?.doNots ?? []), ...kit.imagery.avoid.map((a) => `No ${a} imagery.`), 'No colours outside the palette.', `No fonts other than ${[...new Set([kit.typography.display.family, kit.typography.heading.family, kit.typography.body.family, kit.typography.caption.family])].join(', ')}.`].filter(Boolean),
  };
}

// A patch comes from the AI (update_brand_kit) or an older save, so every field is checked, not
// trusted: the prompt, the brand-* templates and Settings read these without guards. One recipe
// saved without `moves` once failed every chat turn at `r.moves.join`.
type Loose<T> = { [K in keyof T]?: unknown };
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, fallback = '') => (isText(v) ? v : fallback);
const count = (v: unknown, fallback: number) => (isNumber(v) ? v : fallback);
const texts = (v: unknown, fallback: string[] = []) => (Array.isArray(v) ? v.filter(isText) : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
/** The `keys` of `from` whose values pass `ok`; the rest are left out, not defaulted. */
const valid = <K extends string, V>(from: unknown, keys: readonly K[], ok: (v: unknown) => v is V): Partial<Record<K, V>> =>
  isObject(from) ? (Object.fromEntries(keys.filter((k) => ok(from[k])).map((k) => [k, from[k]])) as Partial<Record<K, V>>) : {};

type Motion = BrandGuideline['motion'];
type MotionFields = Partial<Omit<Motion, 'easing' | 'timing'>> & { easing?: Partial<Motion['easing']>; timing?: Partial<Motion['timing']> };

/** The motion fields a patch sets, each checked: numbers finite, easings strings. */
function motionFields(v: unknown): MotionFields {
  if (!isObject(v)) return {};
  const easing = valid(v.easing, ['enter', 'exit', 'move'] as const, isText);
  const timing = valid(v.timing, ['enter', 'exit', 'hold', 'stagger', 'wordStagger'] as const, isNumber);
  return {
    ...(Array.isArray(v.principles) ? { principles: texts(v.principles) } : {}),
    ...valid(v, ['fps', 'distance', 'blur', 'overshoot'] as const, isNumber),
    ...(Object.keys(easing).length ? { easing } : {}),
    ...(Object.keys(timing).length ? { timing } : {}),
  };
}

/** The colour fields a guideline keeps refined; stage, roles and the type scale always follow the tokens. */
const colorFields = (v: unknown): Partial<Pick<BrandGuideline['color'], 'ratio' | 'rules'>> =>
  isObject(v) ? { ...valid(v, ['ratio'] as const, isText), ...(Array.isArray(v.rules) ? { rules: texts(v.rules) } : {}) } : {};

function wholeRecipe(r: Loose<SceneRecipe> & { id: string }): SceneRecipe {
  const background = isObject(r.background) ? r.background : {};
  return {
    id: r.id,
    name: text(r.name, r.id),
    use: text(r.use),
    layout: text(r.layout),
    background: { ...background, kind: oneOf(background.kind, ['solid', 'gradient', 'procedural', 'footage'] as const, 'solid'), colors: texts(background.colors), note: text(background.note) },
    moves: texts(r.moves),
    ...(typeof r.template === 'string' ? { template: r.template } : {}),
    copy: text(r.copy),
    hold: count(r.hold, 2),
  };
}

function wholeMove(m: Loose<BrandMove> & { id: string }): BrandMove {
  const elements = (Array.isArray(m.elements) ? m.elements : []).filter(isObject).map((e): MoveElement => ({
    ...e,
    name: text(e.name, text(e.role, 'element')),
    role: text(e.role, 'shape') as MoveRole,
    keys: (Array.isArray(e.keys) ? e.keys : []).filter(isObject).map((k): MoveKey => ({ ...k, frame: count(k.frame, 0), state: isObject(k.state) ? (k.state as FrameState) : {} })),
  }));
  return { id: m.id, name: text(m.name, m.id), use: text(m.use), description: text(m.description), fps: count(m.fps, FPS), frames: count(m.frames, FPS), elements };
}

function wholeLayout(l: Loose<BrandLayoutSpec> & { id: string }): BrandLayoutSpec {
  const zones = (Array.isArray(l.zones) ? l.zones : []).filter(isObject).map((z): LayoutZone => ({
    ...z,
    role: text(z.role, 'media'),
    name: text(z.name, text(z.role, 'zone')),
    x: count(z.x, 0), y: count(z.y, 0), w: count(z.w, 1), h: count(z.h, 1),
    align: oneOf(z.align, ['left', 'center', 'right'] as const, 'left'),
  }));
  return { id: l.id, name: text(l.name, l.id), aspect: oneOf(l.aspect, ['16:9', '9:16', '1:1', '4:5'] as const, '16:9'), use: text(l.use), zones };
}

/** `patch`'s items merged into `base` by id; an id `base` lacks starts from `from`'s item, so a partial patch of it stays whole. */
const byId = <T extends { id: string }>(base: T[], patch: unknown, whole: (item: Loose<T> & { id: string }) => T, from: T[] = []): T[] => {
  if (!Array.isArray(patch)) return base;
  const out = [...base];
  for (const item of patch) {
    if (!isObject(item) || typeof item.id !== 'string') continue;
    const at = out.findIndex((b) => b.id === item.id);
    const merged = { ...(at >= 0 ? out[at] : from.find((b) => b.id === item.id) ?? {}), ...item } as Loose<T> & { id: string };
    if (at >= 0) out[at] = whole(merged);
    else out.push(whole(merged));
  }
  return out;
};

/** A refined guideline merged over the derived one: moves, layouts and recipes merge by id. */
export function mergeGuideline(base: BrandGuideline, patch: Record<string, unknown>, source: BrandGuideline['source'] = 'ai'): BrandGuideline {
  const p = patch as Loose<BrandGuideline>;
  const color = isObject(p.color) ? (p.color as Loose<BrandGuideline['color']>) : null;
  const motion = motionFields(p.motion);
  return {
    ...base,
    ...(typeof p.summary === 'string' ? { summary: p.summary } : {}),
    color: color
      ? {
          ratio: text(color.ratio, base.color.ratio),
          stage: { ...base.color.stage, ...(isObject(color.stage) ? color.stage : {}) },
          roles: Array.isArray(color.roles) ? color.roles.filter(isObject).map((r) => ({ role: text(r.role), hex: text(r.hex), use: text(r.use) })) : base.color.roles,
          rules: texts(color.rules, base.color.rules),
        }
      : base.color,
    typeScale: Array.isArray(p.typeScale) ? base.typeScale.map((step) => ({ ...step, ...((p.typeScale as TypeStep[]).find((s) => isObject(s) && s.role === step.role) ?? {}) })) : base.typeScale,
    motion: { ...base.motion, ...motion, easing: { ...base.motion.easing, ...motion.easing }, timing: { ...base.motion.timing, ...motion.timing } },
    moves: byId(base.moves, p.moves, wholeMove),
    layouts: byId(base.layouts, p.layouts, wholeLayout),
    recipes: byId(base.recipes, p.recipes, wholeRecipe),
    dos: texts(p.dos, base.dos),
    donts: texts(p.donts, base.donts),
    source,
    updatedAt: now(),
  };
}

/** The guideline every consumer reads: the refinements kept on the kit, over the derived one. */
export function guidelineOf(kit: BrandKit): BrandGuideline {
  const derived = deriveGuideline(kit);
  if (!kit.guideline || kit.guideline.source === 'derived') return derived;
  // Colours and type always follow the kit's current tokens; the refined moves, layouts and recipes stay.
  return { ...mergeGuideline(derived, kit.guideline as unknown as Record<string, unknown>, kit.guideline.source), color: { ...derived.color, rules: texts(kit.guideline.color?.rules, derived.color.rules), ratio: text(kit.guideline.color?.ratio, derived.color.ratio) }, typeScale: derived.typeScale, updatedAt: kit.guideline.updatedAt };
}

// ── what a kit keeps ─────────────────────────────────────────────────────────

// A kit keeps only what the AI or the user refined, never a copy of the whole guideline: then
// every part nobody refined (the timing, the other moves, the summary, dos and donts) still
// follows the kit's motion, layout and logo edits, because `guidelineOf` merges the refinements
// over a fresh derivation. The kit field is typed as a whole guideline; `guidelineOf` is its only
// reader and takes either.
type Refinements = Pick<BrandGuideline, 'version' | 'source' | 'updatedAt'> &
  Partial<Pick<BrandGuideline, 'summary' | 'moves' | 'layouts' | 'recipes' | 'dos' | 'donts'>> & { color?: ReturnType<typeof colorFields>; motion?: MotionFields };

/** Deep equality that ignores key order (a kit read back from settings has its keys sorted). */
const same = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (!isObject(a) || !isObject(b)) return a === b;
  const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== undefined);
  return keys(a).length === keys(b).length && keys(a).every((k) => same(a[k], b[k]));
};

/** The fields of `fields` that differ from `base`, nested objects compared field by field. */
function unlike(fields: Record<string, unknown>, base: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const inner = isObject(v) && isObject(base[k]) ? unlike(v, base[k] as Record<string, unknown>) : null;
    if (inner ? Object.keys(inner).length : !same(v, base[k])) out[k] = inner ?? v;
  }
  return out;
}

/**
 * What a kit keeps refined, or null. A guideline an older Helios saved whole (it has a type scale,
 * which refinements never carry) is cut down to the parts that differ from the one derived from
 * this kit — the kit it was derived from, as long as nothing has changed since.
 */
function refinementsOf(kit: BrandKit, derived: BrandGuideline): Refinements | null {
  const g = kit.guideline as Loose<BrandGuideline> | null | undefined;
  if (!isObject(g) || g.source === 'derived') return null;
  if (!Array.isArray(g.typeScale)) return g as unknown as Refinements;
  const changed = <T extends { id: string }>(items: unknown, base: T[]) =>
    (Array.isArray(items) ? items : []).filter((item) => isObject(item) && isText(item.id) && !same(item, base.find((b) => b.id === item.id))) as T[];
  const lists = { moves: changed(g.moves, derived.moves), layouts: changed(g.layouts, derived.layouts), recipes: changed(g.recipes, derived.recipes) };
  const lines = (v: unknown) => (Array.isArray(v) ? texts(v) : undefined);
  return {
    ...(unlike({ summary: isText(g.summary) ? g.summary : undefined, color: colorFields(g.color), motion: motionFields(g.motion), dos: lines(g.dos), donts: lines(g.donts) }, derived) as Partial<Refinements>),
    ...Object.fromEntries(Object.entries(lists).filter(([, items]) => items.length)),
    version: 1,
    source: g.source === 'edited' ? 'edited' : 'ai',
    updatedAt: text(g.updatedAt, now()),
  };
}

/** The kit with a guideline an older Helios saved whole cut down to its refinements; any other kit as it is. */
export function compactGuideline(kit: BrandKit): BrandKit {
  if (!isObject(kit.guideline) || kit.guideline.source === 'derived' || !Array.isArray(kit.guideline.typeScale)) return kit;
  return { ...kit, guideline: refinementsOf(kit, deriveGuideline(kit)) as unknown as BrandGuideline };
}

/**
 * The refinements a kit keeps after `patch`: the ones it had, with the patch's fields set over
 * them. Moves, layouts and recipes merge by id; one the kit has not refined yet starts from the
 * derived one, so a partial patch of it stays whole.
 */
export function refineGuideline(kit: BrandKit, patch: Record<string, unknown>, source: BrandGuideline['source'] = 'ai'): BrandGuideline {
  const derived = deriveGuideline(kit);
  const kept: Partial<Refinements> = refinementsOf(kit, derived) ?? {};
  const p = patch as Loose<BrandGuideline>;
  const color = { ...kept.color, ...colorFields(p.color) };
  const set = motionFields(p.motion);
  const easing = { ...kept.motion?.easing, ...set.easing };
  const timing = { ...kept.motion?.timing, ...set.timing };
  const motion: MotionFields = { ...kept.motion, ...set, ...(Object.keys(easing).length ? { easing } : {}), ...(Object.keys(timing).length ? { timing } : {}) };
  const refined: Refinements = {
    ...kept,
    ...(isText(p.summary) ? { summary: p.summary } : {}),
    ...(Object.keys(color).length ? { color } : {}),
    ...(Object.keys(motion).length ? { motion } : {}),
    ...(Array.isArray(p.moves) ? { moves: byId(kept.moves ?? [], p.moves, wholeMove, derived.moves) } : {}),
    ...(Array.isArray(p.layouts) ? { layouts: byId(kept.layouts ?? [], p.layouts, wholeLayout, derived.layouts) } : {}),
    ...(Array.isArray(p.recipes) ? { recipes: byId(kept.recipes ?? [], p.recipes, wholeRecipe, derived.recipes) } : {}),
    ...(Array.isArray(p.dos) ? { dos: texts(p.dos) } : {}),
    ...(Array.isArray(p.donts) ? { donts: texts(p.donts) } : {}),
    version: 1,
    source,
    updatedAt: now(),
  };
  return refined as unknown as BrandGuideline;
}

/** Where a zone of a layout sits on a canvas, in px. */
export function zoneRect(z: LayoutZone, width: number, height: number) {
  return { x: z.x * width, y: z.y * height, w: z.w * width, h: z.h * height };
}

/** The layout of a kind (title, lower-third, stat, split, end-card, captions) for a canvas. */
export function layoutFor(g: BrandGuideline, kind: string, width: number, height: number): BrandLayoutSpec | undefined {
  const r = width / height;
  const aspect = r < 0.8 ? '9:16' : r < 1.2 ? '1:1' : '16:9';
  const tag = aspect.replace(':', 'x');
  return g.layouts.find((l) => l.id === `${kind}-${tag}`) ?? g.layouts.find((l) => l.id.startsWith(`${kind}-`) && l.aspect === (aspect === '1:1' ? '16:9' : aspect)) ?? g.layouts.find((l) => l.id.startsWith(`${kind}-`));
}

/** An element's state at `frame`, interpolated between its keys (linear between keys; for previews). */
export function stateAt(element: MoveElement, frame: number): Required<FrameState> {
  const rest: Required<FrameState> = { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0, blur: 0, clip: 1, tracking: 0 };
  const keys = [...element.keys].sort((a, b) => a.frame - b.frame);
  const out = { ...rest };
  for (const prop of Object.keys(rest) as (keyof FrameState)[]) {
    const withProp = keys.filter((k) => k.state[prop] !== undefined);
    if (!withProp.length) continue;
    if (frame <= withProp[0].frame) { out[prop] = withProp[0].state[prop]!; continue; }
    const last = withProp[withProp.length - 1];
    if (frame >= last.frame) { out[prop] = last.state[prop]!; continue; }
    const i = withProp.findIndex((k) => k.frame > frame);
    const a = withProp[i - 1];
    const b = withProp[i];
    const t = (frame - a.frame) / Math.max(1, b.frame - a.frame);
    const eased = 1 - Math.pow(1 - t, 3);
    out[prop] = a.state[prop]! + (b.state[prop]! - a.state[prop]!) * eased;
  }
  return out;
}
