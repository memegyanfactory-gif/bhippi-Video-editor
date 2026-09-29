// The Remotion Kit marketplace (remotion-kit.com/marketplace) as a reference library for the AI.
//
// presets.json is refreshed by scripts/import-remotion-kit.mjs. Each preset carries its design
// spec — category, look (tags), copy, palette, fonts and timing as parameter defaults, format and
// preview links — but not its Remotion source, which the marketplace does not publish. So a preset
// is a brief: `rebuildPlan` names the Bhippi template that recreates it and fills that template's
// arguments from the preset's defaults, and the AI adapts copy and colours to the edit.
import { CRIMSON_SLOTS } from '../templateSlots';
import data from './presets.json';

export type RemotionKitParam = {
  key: string;
  type: string;
  label: string;
  default?: unknown;
  options?: unknown[];
  min?: number;
  max?: number;
  group?: string;
};

export type RemotionKitPreset = {
  id: string;
  name: string;
  author: string;
  category: string;
  description: string;
  tags: string[];
  width: number;
  height: number;
  fps: number;
  seconds: number;
  params: RemotionKitParam[];
  thumbnailUrl?: string;
  previewVideoUrl?: string;
  premium?: boolean;
  votes: number;
};

export const REMOTION_KIT_SOURCE = data.source;
export const REMOTION_KIT: RemotionKitPreset[] = data.presets as RemotionKitPreset[];

export const REMOTION_KIT_CATEGORIES = ['intro', 'title', 'lower-third', 'chart', 'map', 'cta', 'social', 'outro', 'transition', 'full'] as const;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function findPreset(id: string | undefined): RemotionKitPreset | undefined {
  if (!id) return undefined;
  const key = norm(id);
  return REMOTION_KIT.find((p) => p.id === id) ?? REMOTION_KIT.find((p) => norm(p.id) === key || norm(p.name) === key);
}

function orientation(p: RemotionKitPreset): 'landscape' | 'vertical' | 'square' {
  return p.width > p.height ? 'landscape' : p.width < p.height ? 'vertical' : 'square';
}

/** Presets scored against the query words (name > tags > description), best first. */
export function listPresets(filter: { category?: string; query?: string; orientation?: string; limit?: number } = {}): RemotionKitPreset[] {
  const words = norm(filter.query ?? '').split(' ').filter(Boolean);
  const scored = REMOTION_KIT.filter((p) => (!filter.category || p.category === filter.category) && (!filter.orientation || orientation(p) === filter.orientation))
    .map((p) => {
      if (!words.length) return { p, score: 1 };
      const name = norm(p.name);
      const tags = p.tags.join(' ');
      const text = norm(`${p.description} ${p.category} ${p.params.map((q) => q.label).join(' ')}`);
      let score = 0;
      for (const w of words) score += (name.includes(w) ? 3 : 0) + (tags.includes(w) ? 2 : 0) + (text.includes(w) ? 1 : 0);
      return { p, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.p.votes - a.p.votes);
  return scored.slice(0, filter.limit ?? 40).map((s) => s.p);
}

export function presetSummary(p: RemotionKitPreset) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    description: p.description,
    format: `${p.width}x${p.height} ${orientation(p)}, ${p.seconds}s`,
    tags: p.tags.slice(0, 8),
    ...(p.premium ? { premium: true } : {}),
  };
}

export function remotionKitCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of REMOTION_KIT) counts[p.category] = (counts[p.category] ?? 0) + 1;
  return counts;
}

const has = (p: RemotionKitPreset, ...words: string[]) => words.some((w) => p.tags.includes(w) || norm(`${p.name} ${p.description}`).includes(w));

/** The Bhippi template that recreates a preset, from its category and look. */
export function helioTemplateFor(p: RemotionKitPreset): { template: string; bit?: string; background?: string; why: string } {
  if (has(p, 'quote')) return { template: 'editorial-quote', why: 'a pull quote' };
  if (has(p, 'countdown')) return { template: 'countdown', why: 'a countdown' };
  if (has(p, 'news', 'breaking')) return { template: 'breaking-news', why: 'a news bulletin' };
  if (has(p, 'comparison', 'versus', ' vs ')) return { template: 'comparison', why: 'an A/B comparison' };
  if (has(p, 'timeline', 'roadmap')) return { template: 'timeline-roadmap', why: 'a timeline' };
  if (has(p, 'counter', 'count up', 'count-up') && !has(p, 'bar')) return { template: 'react-bits', bit: 'count-up', why: 'a counting number' };
  if (has(p, 'glitch')) return { template: 'react-bits', bit: 'glitch-text', why: 'glitch typography' };
  if (has(p, 'typewriter', 'terminal')) return { template: 'react-bits', bit: 'text-type', why: 'typed text' };
  switch (p.category) {
    case 'chart': return { template: 'stat-chart', why: 'animated bars with counting values' };
    case 'map': return { template: 'connected-map', why: 'a hub-and-nodes location map' };
    case 'lower-third': return { template: 'crimson-lower-third', why: 'a name/role lower third' };
    case 'title': return { template: 'ribbon-title', why: 'a chapter/title card' };
    case 'intro': return { template: 'react-bits', bit: 'split-text', background: has(p, 'particles', 'space') ? 'galaxy' : has(p, 'gradient', 'aurora') ? 'aurora' : 'beams', why: 'a text reveal over a moving background' };
    case 'outro': return { template: 'react-bits', bit: 'blur-text', background: 'aurora', why: 'a closing line over a soft background' };
    case 'cta': return { template: 'react-bits', bit: 'star-border', why: 'a call-to-action button/card' };
    case 'social': return { template: 'social-callout', why: 'a social handle callout' };
    case 'transition': return { template: 'cubes-reveal', why: 'a wipe between shots' };
    default: return { template: 'custom', why: 'a full scene: write html/css/js that follows the brief' };
  }
}

const isText = (q: RemotionKitParam) => q.type === 'text' && typeof q.default === 'string' && q.default.trim() !== '' && !/geojson|url|attribution|source/i.test(`${q.key} ${q.label}`);

/** A full brief plus a ready-to-adapt create_motion_graphic call. */
export function describePreset(p: RemotionKitPreset) {
  const copy = p.params.filter(isText).map((q) => ({ key: q.key, label: q.label, text: String(q.default) }));
  const colors = p.params.filter((q) => q.type === 'color' && typeof q.default === 'string').map((q) => ({ key: q.key, label: q.label, color: q.default as string }));
  const fonts = p.params.filter((q) => q.type === 'font' || (q.type === 'select' && /font/i.test(q.key))).map((q) => ({ label: q.label, default: q.default, options: q.options }));
  const images = p.params.filter((q) => q.type === 'image').map((q) => q.label);
  const timing = p.params.filter((q) => q.type === 'number' && /timing|speed|duration|delay|stagger/i.test(`${q.group ?? ''} ${q.key}`)).map((q) => ({ key: q.key, label: q.label, default: q.default }));
  const pick = helioTemplateFor(p);
  const [title, subtitle, ...rest] = copy.map((c) => c.text.replace(/\n/g, ' '));
  const accent = colors.find((c) => /accent|primary|highlight|brand/i.test(c.key))?.color ?? colors.find((c) => !/background|bg/i.test(c.key))?.color;
  const args: Record<string, unknown> = { template: pick.template, title: title ?? p.name, duration: p.seconds };
  if (subtitle) args.subtitle = subtitle;
  if (rest.length && ['teaching-card', 'stat-chart', 'timeline-roadmap', 'comparison', 'connected-map'].includes(pick.template)) args.rows = rest.slice(0, 6);
  // A template that needs rows (and a chart its values) refuses without them: samples to replace.
  const rowSlot = CRIMSON_SLOTS[pick.template]?.rows;
  if (rowSlot?.kind === 'list' && rowSlot.required && ((args.rows as string[] | undefined) ?? []).length < (rowSlot.min ?? 1)) {
    args.rows = ['Point one', 'Point two', 'Point three'].slice(0, Math.max(rowSlot.min ?? 1, Math.min(3, rowSlot.maxItems)));
  }
  if (pick.template === 'stat-chart') {
    args.rows = (args.rows as string[]).map((label) => label.slice(0, 16));
    args.values = (args.rows as string[]).map((_, i) => 30 + i * 25);
  }
  if (pick.bit && !pick.background) { args.bit = pick.bit; args.props = { text: title ?? p.name }; }
  if (pick.background) args.layers = [{ bit: pick.bit, props: { text: title ?? p.name }, layout: 'centre-card', at: 0.3 }];
  if (pick.background) args.background = pick.background;
  if (accent) args.accentColor = accent;
  if (pick.template === 'custom') args.html = `<!-- Rebuild "${p.name}": ${p.description} -->`;
  return {
    ...presetSummary(p),
    author: p.author,
    fps: p.fps,
    copy,
    colors,
    fonts,
    images,
    timing,
    params: p.params.length,
    previewVideoUrl: p.previewVideoUrl,
    thumbnailUrl: p.thumbnailUrl,
    rebuild: {
      why: `Remotion Kit ships no source, so rebuild it in Bhippi: ${pick.why}.`,
      example: { tool: 'create_motion_graphic', args },
      notes: [
        'Replace the placeholder copy with lines from the transcript/script; keep the preset\'s pacing and look.',
        ...(rowSlot?.kind === 'list' && rowSlot.required && pick.template !== 'stat-chart' ? ['The rows are samples: write the real points.'] : []),
        ...(pick.template === 'stat-chart' ? ['The rows and values are samples: use the real labels and figures from the source, one value per row.'] : []),
        'The active brand kit overrides the preset\'s colours and fonts; without one, the preset colours above are a good palette.',
        pick.template === 'custom' ? 'For "custom", write deterministic html/css/js driven by --elapsed (no external files) that follows the description, colours and timing.' : 'For a richer AE-grade version, create_motion_scene with a motion template, or template "custom" with your own html.',
        `Designed at ${p.width}x${p.height}; for the other orientation, reflow the layout rather than scaling.`,
      ],
    },
  };
}
