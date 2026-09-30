// A filled example for every house (Crimson), brand and kinetic template (docs/IMPROVEMENT-TODO.md item 51):
// real-looking words within each slot's limits (templateSlots.ts), so a model copies a call that
// builds right the first time instead of guessing. tests/templateExamples.test.ts holds every one
// to its schema (nothing for the auto-fix to change) and builds it; the thumbnails in
// public/template-thumbs are these examples drawn at their hold frame.
import thumbs from '../../public/template-thumbs/index.json';

/** create_motion_graphic args (without `template`) for each house template. */
export const CRIMSON_EXAMPLES: Record<string, Record<string, unknown>> = {
  'hook-promise': { title: 'Save your first $10,000 this year', subtitle: 'A plan that works on a small salary, step by step', kicker: 'MONEY BASICS' },
  'ribbon-title': { title: 'Chapter two: the plan', subtitle: 'Where every rupee goes', kicker: 'PART 02' },
  'teaching-card': { title: 'The 50/30/20 rule', kicker: 'BUDGETING', rows: ['Needs — rent, food, bills (50%)', 'Wants — fun and travel (30%)', 'Savings — pay yourself first (20%)'], activeIndex: 2 },
  'side-panel': { title: 'Four rules for hooks', kicker: 'WRITING', rows: ['Be specific', 'Open a loop', 'Promise a payoff', 'Cut the intro'] },
  'connected-map': { title: 'What makes a video work', kicker: 'IDEA', rows: ['Story — why we watch', 'Sound — the feeling', 'Pace — the rhythm'] },
  'numbered-lanes': { title: 'Five steps to launch', rows: ['Research', 'Prototype', 'Test', 'Launch', 'Grow'], activeIndex: 0 },
  'editorial-quote': { title: 'Discipline is choosing what you want most over what you want now', accentWord: 'Discipline' },
  comparison: { title: 'Renting vs buying', kicker: 'SAME BUDGET, FIVE YEARS', rows: ['Renting — flexible, no equity, low upfront', 'Buying — builds equity, big upfront cost'] },
  'stat-chart': { title: 'Revenue, in millions', kicker: '2021–2024', rows: ['2021', '2022', '2023', '2024'], values: [12, 19, 31, 48], activeIndex: 3 },
  'timeline-roadmap': { title: 'Our story', rows: ['2015 — Founded', '2017 — First office', '2021 — IPO', '2024 — 1M users'], activeIndex: 3 },
  'cursor-demo': { title: 'Ask, and it builds', subtitle: 'Make me a launch video', kicker: 'DEMO', rows: ['Draft ready', 'Music added'] },
  'chapter-marker': { title: 'Investing basics', kicker: '03' },
  'caption-phrase': { title: 'This changes everything', accentWord: 'everything' },
  'crimson-lower-third': { title: 'Priya Raman', subtitle: 'Head of Growth, Finlo' },
  'cubes-reveal': {},
  countdown: { metric: '10', title: 'Starting in' },
  'breaking-news': { title: 'Markets fall 4% after the rate decision', subtitle: 'Central bank raises rates by half a point', badge: 'BREAKING' },
};

/** create_motion_scene params for the brand templates (built in the active kit). */
export const BRAND_EXAMPLES: Record<string, Record<string, unknown>> = {
  'brand-title': { title: 'Money, without the maze', kicker: 'PAYFAST', subtitle: 'Send, save and spend in one place', accentWord: 'maze' },
  'brand-lower-third': { name: 'Priya Raman', role: 'Head of Growth' },
  'brand-stat': { value: 48, suffix: '%', label: 'more revenue in a year' },
  'brand-panel': { title: 'Why teams switch', points: ['Setup in a day', 'No hidden fees', 'Support that answers'] },
  'brand-logo-sting': { name: 'Payfast', tagline: 'Money, without the maze' },
  'brand-end-card': { headline: 'Start saving today', cta: 'Try it free', accentWord: 'saving' },
  'brand-transition': {},
};

/**
 * create_motion_scene params for the kinetic templates (kineticTemplates.ts): the launch film's own
 * words and times, so a model sees where analyze_song's word list and the scene's song offset go.
 */
export const KINETIC_EXAMPLES: Record<string, Record<string, unknown>> = {
  'type-on-voice': { text: 'An editor with a producer inside.', words: [{ text: 'An', start: 2.96 }, { text: 'editor', start: 3.2 }, { text: 'with', start: 5.76 }, { text: 'a', start: 6.08 }, { text: 'producer', start: 6.32 }, { text: 'inside', start: 6.72 }], offset: 2.66, accent: 'producer', look: 'light' },
  'fly-through-word': { line: 'An editor with a producer inside.', word: 'producer', next: { clipId: '<the next shot>' }, at: 0.6 },
  'word-land': { text: 'Describe the *edit* / you want.', words: [{ text: 'Describe', start: 5.02 }, { text: 'the', start: 5.3 }, { text: 'edit', start: 5.45 }, { text: 'you', start: 5.8 }, { text: 'want', start: 5.95 }], offset: 4.96, look: 'stage' },
  'label-pill': { label: 'Bring your own AI', attach: [0.55, 0.3, 0.38, 0.4], side: 'below', at: 0.3 },
  'slam-tilt': { media: { clipId: '<a UI capture>' }, at: 0.35, title: 'Bhippi cuts the footage', label: '18 cuts, on the beat' },
  'whip-pan': { from: { clipId: '<outgoing shot>' }, to: { clipId: '<incoming shot>' }, direction: 'left', at: 0.5 },
  'match-grow': { from: { clipId: '<the parked picture>' }, to: { clipId: '<the next shot>' }, fromRect: [0.04, 0.7, 0.2, 0.2], anchorFrom: [0.5, 0.35], anchorTo: [0.5, 0.4] },
  'logo-lockup': { name: 'Bhippi', tagline: 'The AI video editor.', at: 0.15, words: [{ text: 'The', start: 34.77 }, { text: 'AI', start: 34.93 }, { text: 'video', start: 35.25 }, { text: 'editor', start: 35.73 }], offset: 33.9 },
  'end-card': { name: 'Bhippi', tagline: 'The AI video editor', cta: 'Try it free', url: 'bhippi.com', beats: [1.2, 1.8, 2.4] },
};

/** The call a model can copy for `template`: which tool, and its args. Null for other kit templates. */
export function exampleCall(template: string): { tool: 'create_motion_graphic' | 'create_motion_scene'; args: Record<string, unknown> } | null {
  if (CRIMSON_EXAMPLES[template]) return { tool: 'create_motion_graphic', args: { template, ...CRIMSON_EXAMPLES[template] } };
  if (BRAND_EXAMPLES[template]) return { tool: 'create_motion_scene', args: { template, params: BRAND_EXAMPLES[template] } };
  if (KINETIC_EXAMPLES[template]) return { tool: 'create_motion_scene', args: { template, params: KINETIC_EXAMPLES[template] } };
  return null;
}

/**
 * Where a template's thumbnail is served from (public/template-thumbs, made by
 * scripts/make-template-thumbs.mjs), or null: templates that need the user's footage have none.
 */
export function thumbnailUrl(template: string): string | null {
  const file = [...thumbs.house, ...thumbs.kit].find((name) => name.replace(/\.(png|jpg)$/, '') === template);
  return file ? `/template-thumbs/${file}` : null;
}
