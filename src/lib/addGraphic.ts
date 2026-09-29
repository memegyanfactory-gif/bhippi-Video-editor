// add_graphic: one graphic from a plain kind and its words (docs/TRAIN-AND-TEMPLATES-PLAN.md Part B).
// A weaker model says what the graphic is — a title, a lower third, a stat, a list — and this picks
// the template, fills its slots and routes the call to the template tool, which fits it (auto-fix,
// templateFix.ts). With a brand kit active the brand-* templates carry the kinds that have one.

export type GraphicKind = 'title' | 'chapter' | 'lower-third' | 'stat' | 'chart' | 'list' | 'steps' | 'timeline' | 'quote' | 'compare' | 'news' | 'countdown' | 'caption' | 'map' | 'end' | 'logo';

/** Words a model uses for each kind. */
const KIND_WORDS: Record<GraphicKind, string[]> = {
  title: ['title', 'hook', 'headline', 'heading', 'intro', 'opener', 'promise', 'big-text', 'text'],
  chapter: ['chapter', 'section', 'part', 'chapter-marker', 'marker'],
  'lower-third': ['lower-third', 'lowerthird', 'name', 'speaker', 'name-tag', 'nametag', 'person', 'guest', 'lower'],
  stat: ['stat', 'number', 'metric', 'figure', 'counter', 'count-up', 'percentage', 'kpi'],
  chart: ['chart', 'bar-chart', 'bars', 'graph', 'data'],
  list: ['list', 'points', 'bullets', 'tips', 'rules', 'card', 'teaching-card', 'explainer', 'panel', 'side-panel', 'checklist'],
  steps: ['steps', 'roadmap', 'process', 'stages', 'how-to', 'lanes', 'journey', 'path'],
  timeline: ['timeline', 'history', 'dates', 'milestones', 'years'],
  quote: ['quote', 'statement', 'saying', 'emphasis', 'pull-quote', 'key-line'],
  compare: ['compare', 'comparison', 'vs', 'versus', 'a-b', 'before-after', 'pros-cons'],
  news: ['news', 'breaking', 'breaking-news', 'alert', 'ticker', 'headline-bar', 'bar'],
  countdown: ['countdown', 'timer', 'count-down'],
  caption: ['caption', 'phrase', 'subtitle-card', 'callout'],
  map: ['map', 'relationships', 'connections', 'hub', 'mind-map', 'network'],
  end: ['end', 'end-card', 'endcard', 'outro', 'cta', 'call-to-action', 'subscribe', 'closing'],
  logo: ['logo', 'ident', 'sting', 'brand-sting', 'logo-sting'],
};
export const GRAPHIC_KINDS = Object.keys(KIND_WORDS) as GraphicKind[];

/** The kind a model's word names, or null. */
export function graphicKind(word: string): GraphicKind | null {
  const w = word.trim().toLowerCase().replace(/[\s_/]+/g, '-');
  return GRAPHIC_KINDS.find((kind) => KIND_WORDS[kind].includes(w)) ?? GRAPHIC_KINDS.find((kind) => KIND_WORDS[kind].some((alias) => alias.length > 3 && w.includes(alias))) ?? null;
}

export type GraphicInput = {
  kind: string;
  text?: string;
  subtitle?: string;
  kicker?: string;
  points?: unknown;
  values?: unknown;
  value?: unknown;
  prefix?: string;
  suffix?: string;
  accentWord?: string;
  cta?: string;
  side?: string;
  color?: string;
  at?: number;
  duration?: number;
};
export type GraphicCall = { tool: 'create_motion_graphic' | 'create_motion_scene'; args: Record<string, unknown>; template: string; kind: GraphicKind };

/**
 * The template call that makes `input`: which tool, which template, its args. `brand`: a brand kit
 * is active. Errors name what is missing in words a small model can act on.
 */
export function graphicCall(input: GraphicInput, brand: boolean): GraphicCall | { error: string } {
  const kind = graphicKind(input.kind ?? '');
  if (!kind) return { error: `Unknown kind "${input.kind}". Use one of: ${GRAPHIC_KINDS.join(', ')}.` };
  const text = (input.text ?? '').trim();
  const needsText = !['countdown', 'logo'].includes(kind);
  if (needsText && !text) return { error: `add_graphic ${kind} needs text (${kind === 'lower-third' ? 'the name' : kind === 'stat' ? 'the label under the number' : 'the words on screen'}).` };
  const timing = { ...(input.at !== undefined ? { start: input.at } : {}), ...(input.duration ? { duration: input.duration } : {}) };
  const graphic = (template: string, args: Record<string, unknown>): GraphicCall => ({ tool: 'create_motion_graphic', template, kind, args: { template, ...args, ...(input.color ? { accentColor: input.color } : {}), ...timing } });
  // Brand graphics lie over the footage (no stage of their own); the scene tool starts at 0 when not told.
  const scene = (template: string, params: Record<string, unknown>): GraphicCall => ({ tool: 'create_motion_scene', template, kind, args: { template, params: { ...params, background: 'none' }, start: input.at ?? 0, ...(input.duration ? { duration: input.duration } : {}), ...(input.color ? { accent: input.color } : {}) } });
  const points = input.points;
  const side = input.side === 'left' || input.side === 'right' ? input.side : undefined;

  switch (kind) {
    case 'title':
      if (brand) return scene('brand-title', { title: text, kicker: input.kicker, subtitle: input.subtitle, accentWord: input.accentWord });
      return graphic((input.at ?? 0) < 3 ? 'hook-promise' : 'ribbon-title', { title: text, subtitle: input.subtitle, kicker: input.kicker });
    case 'chapter':
      if (brand) return scene('brand-title', { title: text, kicker: input.kicker ?? 'CHAPTER', subtitle: input.subtitle });
      return graphic('chapter-marker', { title: text, kicker: input.kicker, subtitle: input.subtitle });
    case 'lower-third':
      if (brand) return scene('brand-lower-third', { name: text, role: input.subtitle ?? input.kicker });
      return graphic('crimson-lower-third', { title: text, subtitle: input.subtitle ?? input.kicker });
    case 'stat': {
      const value = input.value ?? (/\d/.test(text) ? text : undefined);
      if (value === undefined || value === '') return { error: 'add_graphic stat needs value (the real number, e.g. 87 or "2.5"); text is the label under it.' };
      return scene('brand-stat', { value, prefix: input.prefix, suffix: input.suffix, label: text === String(value) ? input.subtitle : text });
    }
    case 'chart':
      if (!points || !input.values) return { error: 'add_graphic chart needs points (the bar labels) and values (one real number per bar).' };
      return graphic('stat-chart', { title: text, subtitle: input.subtitle, kicker: input.kicker, rows: points, values: input.values });
    case 'list':
      if (!points) return { error: 'add_graphic list needs points: 2–5 short lines ("Heading — detail" gives a line under each).' };
      if (brand) return scene('brand-panel', { title: text, points, side: side ?? 'left' });
      return graphic(side ? 'side-panel' : 'teaching-card', { title: text, subtitle: input.subtitle, kicker: input.kicker, rows: points, ...(side ? { layout: side === 'left' ? 'side-panel-left' : 'side-panel-right' } : {}) });
    case 'steps':
      if (!points) return { error: 'add_graphic steps needs points: the steps in order (2–6).' };
      return graphic('numbered-lanes', { title: text, subtitle: input.subtitle, kicker: input.kicker, rows: points });
    case 'timeline':
      if (!points) return { error: 'add_graphic timeline needs points: "Date — what happened", in order (2–6).' };
      return graphic('timeline-roadmap', { title: text, subtitle: input.subtitle, kicker: input.kicker, rows: points });
    case 'quote':
      if (brand) return scene('brand-title', { title: `“${text.replace(/^["“]|["”]$/g, '')}”`, subtitle: input.subtitle, accentWord: input.accentWord });
      return graphic('editorial-quote', { title: text, subtitle: input.subtitle, accentWord: input.accentWord, kicker: input.kicker });
    case 'compare':
      if (!points) return { error: 'add_graphic compare needs points: exactly two, side A and side B ("Renting — flexible, no equity").' };
      return graphic('comparison', { title: text, subtitle: input.subtitle, kicker: input.kicker, rows: points });
    case 'news':
      return graphic('breaking-news', { title: text, subtitle: input.subtitle, badge: input.kicker });
    case 'countdown': {
      const from = input.value ?? (/^\d+$/.test(text) ? text : input.duration ? Math.round(input.duration) : undefined);
      if (from === undefined) return { error: 'add_graphic countdown needs value: the number it counts down from.' };
      return graphic('countdown', { metric: String(from), title: /^\d+$/.test(text) ? undefined : text || undefined });
    }
    case 'caption':
      return graphic('caption-phrase', { title: text, accentWord: input.accentWord });
    case 'map':
      if (!points) return { error: 'add_graphic map needs points: 2–4 short node names around the hub.' };
      return graphic('connected-map', { title: text, kicker: input.kicker, rows: points });
    case 'end':
      return scene('brand-end-card', { headline: text, cta: input.cta ?? input.subtitle, accentWord: input.accentWord });
    case 'logo':
      return scene('brand-logo-sting', { ...(text ? { name: text } : {}), tagline: input.subtitle });
  }
}
