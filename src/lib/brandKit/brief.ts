// The creative brief behind a new brand: what the person told us, in a shape the direction generator
// reads. `parseBrief` pulls what it can out of one free-text description ("A playful kids' bakery in
// Mumbai called Sunny Crumbs, hand-drawn, warm pinks"), locally and deterministically, so the wizard
// can prefill every later question from a single sentence.

export type Sliders = {
  /** 0 playful … 1 serious. */
  serious: number;
  /** 0 minimal … 1 expressive. */
  expressive: number;
  /** 0 warm … 1 cool. */
  cool: number;
  /** 0 classic … 1 modern. */
  modern: number;
};

export const DEFAULT_SLIDERS: Sliders = { serious: 0.5, expressive: 0.5, cool: 0.5, modern: 0.5 };

export type BriefLogo = { svg?: string | null; dataUrl?: string | null; path?: string | null; label: string };

export type Brief = {
  name: string;
  /** "What do you make?" — one sentence. */
  makes: string;
  audience: string;
  industry: string;
  sliders: Sliders;
  /** Words that describe it. */
  words: string[];
  /** Colours named in the description (hex). */
  colorHints: string[];
  /** A city, country or culture the brand nods to. */
  city: string;
  mode: 'auto' | 'dark' | 'light';
  siteUrl: string;
  siteColors: string[];
  siteBackground: string | null;
  imageColors: string[];
  logoColors: string[];
  logo: BriefLogo | null;
};

export const emptyBrief = (): Brief => ({
  name: '', makes: '', audience: '', industry: '', sliders: { ...DEFAULT_SLIDERS }, words: [], colorHints: [], city: '', mode: 'auto',
  siteUrl: '', siteColors: [], siteBackground: null, imageColors: [], logoColors: [], logo: null,
});

const clamp = (n: number, lo = 0.04, hi = 0.96) => Math.max(lo, Math.min(hi, n));

// ── vocabulary ───────────────────────────────────────────────────────────────

type Axis = keyof Sliders;
type Feel = { axis: Axis; delta: number; label: string };

/** Feeling words → a push on one slider (negative = the left end). */
const FEELINGS: [RegExp, Feel[]][] = [
  [/\b(playful|fun|cheeky|whimsical|quirky|friendly|joyful|cheerful|bubbly|silly)\b/i, [{ axis: 'serious', delta: -0.34, label: 'Playful' }]],
  [/\b(serious|professional|trustworthy|corporate|formal|credible|reliable|authoritative|dependable)\b/i, [{ axis: 'serious', delta: 0.34, label: 'Trustworthy' }]],
  [/\b(minimal|minimalist|clean|simple|quiet|spare|understated|calm|restrained)\b/i, [{ axis: 'expressive', delta: -0.34, label: 'Minimal' }]],
  [/\b(bold|loud|vibrant|colou?rful|expressive|electric|punchy|daring|energetic|vivid|maximal)\b/i, [{ axis: 'expressive', delta: 0.34, label: 'Bold' }]],
  [/\b(warm|cosy|cozy|handmade|hand-made|hand-drawn|hand drawn|earthy|organic|homely|inviting|rustic|crafted)\b/i, [{ axis: 'cool', delta: -0.3, label: 'Warm' }]],
  [/\b(cool|icy|crisp|techy|futuristic|digital|fresh|sleek)\b/i, [{ axis: 'cool', delta: 0.3, label: 'Crisp' }]],
  [/\b(classic|timeless|vintage|heritage|retro|elegant|traditional|old-school|refined|nostalgic)\b/i, [{ axis: 'modern', delta: -0.34, label: 'Timeless' }]],
  [/\b(modern|futuristic|innovative|cutting-edge|contemporary|new-age|forward)\b/i, [{ axis: 'modern', delta: 0.34, label: 'Modern' }]],
  [/\b(hand-drawn|hand drawn|handmade|illustrated)\b/i, [{ axis: 'modern', delta: -0.12, label: 'Hand-drawn' }, { axis: 'serious', delta: -0.1, label: 'Hand-drawn' }]],
  [/\b(luxury|luxurious|premium|upscale|high-end|exclusive)\b/i, [{ axis: 'serious', delta: 0.22, label: 'Luxurious' }, { axis: 'expressive', delta: -0.12, label: 'Luxurious' }]],
  [/\b(moody|cinematic|dramatic|dark)\b/i, [{ axis: 'serious', delta: 0.2, label: 'Moody' }]],
  [/\b(edgy|rebellious|streetwise|street|gritty)\b/i, [{ axis: 'expressive', delta: 0.22, label: 'Edgy' }, { axis: 'modern', delta: 0.1, label: 'Edgy' }]],
  [/\b(gentle|soft|soothing|kind|caring|nurturing)\b/i, [{ axis: 'expressive', delta: -0.18, label: 'Gentle' }, { axis: 'serious', delta: -0.05, label: 'Gentle' }]],
];

export const FEELING_WORDS = ['Playful', 'Warm', 'Trustworthy', 'Bold', 'Minimal', 'Timeless', 'Modern', 'Luxurious', 'Handmade', 'Energetic', 'Calm', 'Cheeky', 'Moody', 'Friendly', 'Premium', 'Edgy'];

/** Colour words → a pleasant, brandable hex. */
const COLOR_WORDS: [RegExp, string][] = [
  [/\b(red|scarlet)\b/i, '#E5383B'], [/\bcrimson\b/i, '#B3202E'], [/\bburgundy|maroon|wine\b/i, '#6B1F2A'],
  [/\b(pink|rose|blush)\b/i, '#F472B6'], [/\bmagenta|fuchsia\b/i, '#D946EF'], [/\bcoral\b/i, '#FF6B5E'], [/\bpeach\b/i, '#FFB38A'],
  [/\b(orange|saffron|tangerine)\b/i, '#F97316'], [/\bterracotta|clay|rust\b/i, '#C8553D'], [/\bmustard\b/i, '#D9A400'],
  [/\b(yellow|sunny|lemon|marigold)\b/i, '#FACC15'], [/\bgold|golden\b/i, '#C9A961'],
  [/\b(green|emerald)\b/i, '#22A06B'], [/\bmint\b/i, '#6EE7B7'], [/\bsage\b/i, '#9CAF88'], [/\bolive\b/i, '#6B7A3A'], [/\bforest\b/i, '#1F5D3A'],
  [/\b(teal|turquoise|aqua)\b/i, '#14B8A6'], [/\b(sky|cyan)\b/i, '#38BDF8'], [/\bnavy\b/i, '#0B1F4D'], [/\b(blue|cobalt|azure)\b/i, '#2563EB'],
  [/\b(purple|violet|plum)\b/i, '#7C3AED'], [/\blavender|lilac\b/i, '#B8A4F5'],
  [/\b(brown|chocolate|cocoa|coffee-colou?red)\b/i, '#7A4A2B'], [/\bcream|ivory\b/i, '#F4EBD9'],
];

type Industry = { label: string; test: RegExp; probes: string[]; push?: Partial<Sliders>; thing: string };
export const INDUSTRIES: Industry[] = [
  { label: 'Bakery & café', test: /\b(bak(?:ery|eries|ing|er)|caf[eé]s?|coffee|pastr(?:y|ies)|cakes?|dessert|patisserie|cookies?|bread)\b/i, probes: ['bakeries', 'cafes', 'food', 'craft', 'coffee', 'home goods'], push: { serious: -0.08, cool: -0.1 }, thing: 'fresh bakes' },
  { label: 'Kids & family', test: /\b(kids?|children|child|toys?|toddlers?|babies|baby|preschool|nursery|family)\b/i, probes: ['children', 'kids', 'toys', 'family', 'edtech', 'education'], push: { serious: -0.12 }, thing: 'things kids love' },
  { label: 'Fintech & finance', test: /\b(fintech|bank(?:ing)?|payments?|finance|financial|invest(?:ing|ment|ors?)?|wealth|insur(?:ance|er)|crypto|trading|loans?|accounting)\b/i, probes: ['fintech', 'banking', 'payments', 'wealth', 'finance', 'insurance', 'neobanks', 'analytics'], push: { serious: 0.12, cool: 0.08 }, thing: 'money that makes sense' },
  { label: 'Film & entertainment', test: /\b(film|films|cinema|movies?|trailers?|streaming|production house|video production|documentary)\b/i, probes: ['film', 'streaming', 'trailers', 'cinematic', 'gaming'], push: { serious: 0.08 }, thing: 'stories worth watching' },
  { label: 'Fashion & luxury', test: /\b(fashion|luxury|jewel(?:ry|lery)|couture|boutique|apparel|clothing|watches)\b/i, probes: ['fashion', 'jewellery', 'luxury', 'hospitality', 'private banking'], push: { serious: 0.1, expressive: -0.05 }, thing: 'things worth wearing' },
  { label: 'Sport & fitness', test: /\b(fitness|gym|sports?|athlet(?:e|es|ic|ics)|workout|running|training|crossfit)\b/i, probes: ['sportswear', 'fitness', 'energy', 'esports'], push: { expressive: 0.1, serious: -0.05 }, thing: 'strength you can feel' },
  { label: 'Wellness & beauty', test: /\b(wellness|spa|meditat(?:e|ion)|therapy|sleep|mindful(?:ness)?|yoga|skincare|beauty|cosmetics?|self-care)\b/i, probes: ['meditation', 'spas', 'skincare', 'healthcare', 'therapy', 'organic'], push: { expressive: -0.1 }, thing: 'calm you can keep' },
  { label: 'Tech & SaaS', test: /\b(saas|software|apps?|ai|startup|startups|developers?|platform|cloud|data|tech|api|devtools?)\b/i, probes: ['saas', 'ai', 'developer', 'cloud', 'tech', 'startups', 'data'], push: { modern: 0.1, cool: 0.1 }, thing: 'software people enjoy' },
  { label: 'Gaming & nightlife', test: /\b(gaming|games?|esports|nightlife|club|streetwear|dj|festival)\b/i, probes: ['gaming', 'esports', 'nightlife', 'streetwear', 'events'], push: { expressive: 0.15, modern: 0.1 }, thing: 'nights people remember' },
  { label: 'Food & drink', test: /\b(restaurants?|food|kitchen|chef|grocery|organic|farm|snacks?|drinks?|tea|juice|beverage|brewery|sauce)\b/i, probes: ['food', 'organic', 'snacks', 'beverage', 'grocery', 'restaurants', 'craft'], push: { cool: -0.08 }, thing: 'food worth sharing' },
  { label: 'Real estate & design', test: /\b(real estate|property|realtor|architects?|architecture|interiors?|homes?)\b/i, probes: ['real estate', 'architecture', 'property', 'design tools'], push: { expressive: -0.08 }, thing: 'places to live well' },
  { label: 'Media & publishing', test: /\b(news|magazines?|publish(?:er|ing)|podcasts?|media|blogs?|journal(?:ism)?|newsletter)\b/i, probes: ['news', 'media', 'publishing', 'think tanks'], thing: 'stories that matter' },
  { label: 'Education', test: /\b(schools?|courses?|learn(?:ing)?|education|teach(?:er|ing)?|tutor(?:ing)?|academy|bootcamp)\b/i, probes: ['education', 'edtech', 'children'], thing: 'learning that sticks' },
  { label: 'Health', test: /\b(clinics?|health(?:care)?|medical|hospital|doctors?|dental|pharma(?:cy)?)\b/i, probes: ['healthcare', 'health', 'therapy', 'professional services'], push: { serious: 0.08, cool: 0.05 }, thing: 'care you can trust' },
  { label: 'Consulting & services', test: /\b(consult(?:ing|ancy|ants?)|agency|law|legal|lawyers?|professional services|strategy|b2b)\b/i, probes: ['consulting', 'professional services', 'agency', 'b2b', 'banking'], push: { serious: 0.12 }, thing: 'clear answers' },
  { label: 'Creator & channel', test: /\b(creators?|youtube|youtuber|influencers?|channel|vlog(?:s|ger)?|content)\b/i, probes: ['creator', 'explainers', 'channels'], thing: 'videos worth watching' },
  { label: 'Music & audio', test: /\b(music|records?|bands?|labels?|audio|singer)\b/i, probes: ['record labels', 'nightlife', 'events'], push: { expressive: 0.08 }, thing: 'sound that moves' },
  { label: 'Eco & outdoors', test: /\b(eco|sustainab(?:le|ility)|green|nature|outdoors?|hiking|plants?)\b/i, probes: ['sustainability', 'outdoor', 'organic'], push: { cool: -0.05, modern: -0.05 }, thing: 'a lighter footprint' },
];

export const INDUSTRY_CHIPS = INDUSTRIES.map((i) => i.label);

const AUDIENCES: [RegExp, string][] = [
  [/\b(kids|children|toddlers)\b/i, 'Kids and their parents'], [/\bparents|mums|moms|dads|families|family\b/i, 'Busy families'], [/\b(teens|teenagers|gen[- ]?z)\b/i, 'Gen Z'],
  [/\b(founders|startups?|entrepreneurs)\b/i, 'Founders and startups'], [/\bdevelopers|engineers\b/i, 'Developers'], [/\binvestors\b/i, 'Investors'],
  [/\b(professionals|executives|enterprises?|b2b|businesses)\b/i, 'Professionals and businesses'], [/\bcreators|influencers\b/i, 'Creators'], [/\bstudents|learners\b/i, 'Students'],
  [/\b(foodies|locals|neighbou?rhood)\b/i, 'Local food lovers'], [/\b(film ?makers|cinephiles|audiences?|viewers)\b/i, 'Film lovers'], [/\bgamers\b/i, 'Gamers'],
  [/\b(luxury shoppers|collectors|connoisseurs)\b/i, 'Discerning collectors'], [/\b(athletes|runners)\b/i, 'Athletes'],
];

type City = { test: RegExp; label: string; hints: string[]; push: Partial<Sliders>; words: string[] };
export const CITIES: City[] = [
  { test: /\b(mumbai|bombay|delhi|bangalore|bengaluru|india|indian|jaipur|kolkata|chennai|hyderabad|pune)\b/i, label: 'India', hints: ['#F59E0B', '#D6246E'], push: { expressive: 0.16, cool: -0.1 }, words: ['Vibrant'] },
  { test: /\b(tokyo|kyoto|osaka|japan|japanese)\b/i, label: 'Japan', hints: ['#C8102E'], push: { expressive: -0.18, modern: 0.08 }, words: ['Precise'] },
  { test: /\b(seoul|korea|korean)\b/i, label: 'Korea', hints: [], push: { modern: 0.18, serious: -0.08 }, words: ['Fresh'] },
  { test: /\b(paris|france|french|lyon)\b/i, label: 'France', hints: [], push: { modern: -0.14, serious: 0.05 }, words: ['Elegant'] },
  { test: /\b(rome|milan|italy|italian|florence|naples)\b/i, label: 'Italy', hints: ['#B3202E'], push: { modern: -0.15, cool: -0.08 }, words: ['Heritage'] },
  { test: /\b(london|uk|british|england|scotland)\b/i, label: 'the UK', hints: [], push: { serious: 0.06 }, words: ['Witty'] },
  { test: /\b(new york|nyc|brooklyn|usa|america|american|los angeles)\b/i, label: 'the US', hints: [], push: { modern: 0.1 }, words: ['Confident'] },
  { test: /\b(berlin|germany|german|munich)\b/i, label: 'Germany', hints: [], push: { modern: 0.14, expressive: -0.08, cool: 0.08 }, words: ['Direct'] },
  { test: /\b(copenhagen|stockholm|oslo|helsinki|nordic|scandinavia|scandinavian|denmark|sweden|norway|finland)\b/i, label: 'the Nordics', hints: [], push: { expressive: -0.22, cool: 0.14 }, words: ['Calm'] },
  { test: /\b(dubai|abu dhabi|doha|riyadh|saudi|uae|gulf)\b/i, label: 'the Gulf', hints: ['#C9A961'], push: { serious: 0.1, modern: 0.05 }, words: ['Premium'] },
  { test: /\b(lagos|nigeria|nairobi|kenya|ghana|accra|africa|african|cape town|johannesburg)\b/i, label: 'Africa', hints: ['#F59E0B', '#16A34A'], push: { expressive: 0.2, cool: -0.14 }, words: ['Vibrant'] },
  { test: /\b(mexico|mexican|cdmx|oaxaca)\b/i, label: 'Mexico', hints: ['#E4572E', '#14B8A6'], push: { expressive: 0.24, cool: -0.14, serious: -0.08 }, words: ['Festive'] },
  { test: /\b(brazil|brazilian|sao paulo|são paulo|rio|lisbon|portugal)\b/i, label: 'Brazil and Portugal', hints: ['#16A34A', '#FACC15'], push: { expressive: 0.16, cool: -0.1 }, words: ['Sunny'] },
  { test: /\b(sydney|melbourne|australia|australian|new zealand)\b/i, label: 'Australia', hints: [], push: { serious: -0.06, cool: -0.04 }, words: ['Relaxed'] },
  { test: /\b(singapore|hong kong|shanghai|china|chinese|taipei)\b/i, label: 'East Asia', hints: ['#D4122B'], push: { modern: 0.14 }, words: ['Sharp'] },
  { test: /\b(istanbul|turkey|turkish|morocco|marrakech|cairo|egypt)\b/i, label: 'the Mediterranean', hints: ['#C8553D', '#14B8A6'], push: { expressive: 0.14, cool: -0.14, modern: -0.06 }, words: ['Rich'] },
];

export const EXAMPLE_PROMPTS = [
  'A playful kids\' bakery in Mumbai with a hand-drawn feel',
  'A serious, trustworthy fintech for first-time investors, clean and modern',
  'A moody film studio called "Nightfall Pictures", cinematic and bold',
  'A calm wellness studio in Copenhagen for burnt-out founders',
  'A neon esports crew called Voltage, loud and electric',
  'A heritage olive-oil label from Italy, warm and timeless',
];

// ── parsing ──────────────────────────────────────────────────────────────────

export type ParsedBrief = {
  name?: string;
  makes?: string;
  audience?: string;
  industry?: string;
  city?: string;
  words: string[];
  colorHints: string[];
  mode?: Brief['mode'];
  sliders: Partial<Sliders>;
  /** What was understood, in plain words, for the "I read this as…" line. */
  notes: string[];
};

const STOP = /\s+(?:for|that|which|who|in|with|and|from|based|makes|selling|serving|where|to|of|because|but|so|on|at|using)\b.*$/i;
const titleCase = (s: string) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

function findName(text: string): string | undefined {
  const quoted = text.match(/["“”]([^"“”\n]{1,40})["“”]/);
  if (quoted?.[1].trim()) return quoted[1].trim();
  const called = text.match(/\b(?:called|named|name is|name's|brand is|we are|we're|i am|i'm)\s+([^,.;:\n!?]{1,48})/i);
  if (called) {
    let raw = called[1].trim().replace(STOP, '').trim();
    // "we are a bakery" is not a name: a name does not start with an article.
    if (/^(a|an|the|not|just|building|making)\b/i.test(raw)) return undefined;
    const words = raw.split(/\s+/).slice(0, 4);
    raw = words.join(' ');
    return raw ? (raw === raw.toLowerCase() ? titleCase(raw) : raw) : undefined;
  }
  return undefined;
}

function findAudience(text: string): string | undefined {
  for (const [re, label] of AUDIENCES) if (re.test(text)) return label;
  const aimed = text.match(/\b(?:aimed at|targeting|made for|designed for|built for|for)\s+([^,.;\n]{3,48})/i);
  if (aimed) {
    const raw = aimed[1].trim().replace(STOP, '').trim();
    if (raw.length >= 3 && !/^(a|an|the)\s*$/i.test(raw) && !/^(a|an|the)\s+(feel|look|vibe)/i.test(raw)) return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  return undefined;
}

/** Everything a sentence says about a brand that a slider, a chip or a colour can hold. */
export function parseBrief(text: string): ParsedBrief {
  const t = text.trim();
  const out: ParsedBrief = { words: [], colorHints: [], sliders: {}, notes: [] };
  if (!t) return out;

  out.name = findName(t);
  out.audience = findAudience(t);
  const first = t.split(/(?<=[.!?])\s+|\n/)[0]?.trim() ?? t;
  out.makes = first.length > 160 ? `${first.slice(0, 157).trimEnd()}…` : first;

  const hits = INDUSTRIES.filter((i) => i.test.test(t));
  // The first industry named wins the label; every hit pushes the sliders and the archetype search.
  if (hits.length) {
    const kidsLast = (i: Industry) => (i.label === 'Kids & family' ? 1 : 0);
    const earliest = [...hits].sort((a, b) => kidsLast(a) - kidsLast(b) || t.search(a.test) - t.search(b.test))[0];
    out.industry = earliest.label;
  }

  const deltas: Partial<Sliders> = {};
  const bump = (axis: Axis, d: number) => { deltas[axis] = (deltas[axis] ?? 0) + d; };
  const seen = new Set<string>();
  for (const [re, feels] of FEELINGS) {
    if (!re.test(t)) continue;
    for (const f of feels) { bump(f.axis, f.delta); if (!seen.has(f.label)) { seen.add(f.label); out.words.push(f.label); } }
  }
  for (const i of hits) for (const [axis, d] of Object.entries(i.push ?? {}) as [Axis, number][]) bump(axis, d);

  const city = CITIES.find((c) => c.test.test(t));
  if (city) {
    out.city = city.label;
    for (const [axis, d] of Object.entries(city.push) as [Axis, number][]) bump(axis, d);
    for (const w of city.words) if (!seen.has(w)) { seen.add(w); out.words.push(w); }
  }
  for (const [axis, d] of Object.entries(deltas) as [Axis, number][]) out.sliders[axis] = clamp(0.5 + 0.46 * Math.tanh(d / 0.4));

  const colors: string[] = [];
  // Plurals count ("warm pinks"), a quoted name does not ("Sunny Crumbs" is not yellow).
  const colorText = t.replace(/["“”][^"“”\n]*["“”]/g, ' ').replace(/\b(\w{3,}?)s\b/gi, '$1');
  for (const [re, hex] of COLOR_WORDS) if (re.test(colorText) && !colors.includes(hex)) colors.push(hex);
  out.colorHints = colors.slice(0, 3);
  if (!out.colorHints.length && city) out.colorHints = city.hints.slice(0, 2);

  if (/\b(dark|moody|night|cinematic|midnight|noir|black)\b/i.test(t)) out.mode = 'dark';
  else if (/\b(light|bright|airy|pastel|cream|white)\b/i.test(t)) out.mode = 'light';

  if (out.name) out.notes.push(`called ${out.name}`);
  if (out.industry) out.notes.push(out.industry.toLowerCase());
  if (out.audience) out.notes.push(`for ${out.audience.toLowerCase()}`);
  if (out.city) out.notes.push(`nods to ${out.city}`);
  if (out.words.length) out.notes.push(out.words.slice(0, 4).join(', ').toLowerCase());
  if (out.colorHints.length) out.notes.push(`${out.colorHints.length} colour hint${out.colorHints.length === 1 ? '' : 's'}`);
  return out;
}

/** The parse laid over a brief: only what the text said replaces what was there. */
export function applyParsed(brief: Brief, parsed: ParsedBrief): Brief {
  return {
    ...brief,
    name: parsed.name ?? brief.name,
    makes: parsed.makes ?? brief.makes,
    audience: parsed.audience ?? brief.audience,
    industry: parsed.industry ?? brief.industry,
    city: parsed.city ?? brief.city,
    mode: parsed.mode ?? brief.mode,
    words: [...new Set([...parsed.words, ...brief.words])].slice(0, 8),
    colorHints: parsed.colorHints.length ? parsed.colorHints : brief.colorHints,
    sliders: { ...brief.sliders, ...parsed.sliders },
  };
}

/** What an industry makes, as a phrase a sentence can use ("fresh bakes"). */
export const industryThing = (label: string): string => INDUSTRIES.find((i) => i.label === label)?.thing ?? '';
