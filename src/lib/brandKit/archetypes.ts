// Brand style archetypes — the starting points a kit is built from.
//
// Three groups: the house look (Crimson); sixteen style archetypes distilled from brand-guideline
// practice and the ui8 Brandkit design-system structure (researched and contrast-validated into
// archetypes.json, see docs/research/brand-kit-references.md); and sixteen reference kits rebuilt
// from public "full branding kit" shots on Dribbble — palettes read from the boards, type expressed
// with system-safe families because Helios resolves fonts by installed name only. Everything here
// is data: the AI and the Settings panel turn one of these plus the user's details into a full kit.

import research from './archetypes.json';
import type { BrandArchetype, BrandLayout, Corner, MotionIntensity } from './types';

type Spec = {
  id: string;
  name: string;
  group: BrandArchetype['group'];
  character: string;
  industries: string[];
  /** bg, surface, text, muted, primary, accent, accent2 */
  c: [string, string, string, string, string, string, string];
  gradient?: { angle: number; stops: string[] };
  type: { display: string; weight: number; tracking: string; casing: 'none' | 'uppercase' | 'lowercase' | 'capitalize'; heading: string; body: string; caption: string; headingWeight?: number };
  motion: { easing: string; enter: number; exit: number; hold: number; stagger: number; intensity: MotionIntensity; transitions: string[] };
  imagery: { style: string; sat: number; con: number; warm: number; icons: string; prefix: string; negative: string };
  voice: { tone: string[]; use: string[]; avoid: string[]; samples: string[] };
  layout?: { safeMargin?: number; logoBug?: Corner; lowerThird?: BrandLayout['lowerThird']; captions?: BrandLayout['captions'] };
  audio: { music: string; tempo: [number, number]; sfx: string[] };
};

export const EASE = {
  out: 'cubic-bezier(.16,1,.3,1)',
  soft: 'cubic-bezier(.22,1,.36,1)',
  spring: 'cubic-bezier(.34,1.56,.64,1)',
  inout: 'cubic-bezier(.4,0,.2,1)',
  snap: 'cubic-bezier(.7,0,.2,1)',
  glide: 'cubic-bezier(.25,.1,.25,1)',
};

const define = (s: Spec): BrandArchetype => ({
  id: s.id,
  name: s.name,
  group: s.group,
  character: s.character,
  industries: s.industries,
  colors: { bg: s.c[0], surface: s.c[1], text: s.c[2], muted: s.c[3], primary: s.c[4], accent: s.c[5], accent2: s.c[6] },
  gradient: s.gradient ?? { angle: 135, stops: [s.c[4], s.c[5]] },
  typography: {
    display: { family: s.type.display, weight: s.type.weight, letterSpacing: s.type.tracking, transform: s.type.casing },
    heading: { family: s.type.heading, weight: s.type.headingWeight ?? 600 },
    body: { family: s.type.body, weight: 400 },
    caption: { family: s.type.caption, weight: 600 },
  },
  motion: { ...s.motion },
  imagery: { style: s.imagery.style, grade: { saturation: s.imagery.sat, contrast: s.imagery.con, warmth: s.imagery.warm }, iconography: s.imagery.icons, promptPrefix: s.imagery.prefix, negativePrompt: s.imagery.negative },
  voice: { ...s.voice },
  layout: { safeMargin: s.layout?.safeMargin ?? 0.05, logoBug: s.layout?.logoBug ?? 'top-right', lowerThird: s.layout?.lowerThird ?? 'bottom-left', captions: s.layout?.captions ?? 'bottom-center' },
  audio: { ...s.audio },
});

const NEG = 'blurry, low quality, watermark, text, logo, distorted anatomy, oversaturated, jpeg artifacts';

export const HOUSE_ARCHETYPE: BrandArchetype = define({
  id: 'crimson-house', name: 'Crimson (house)', group: 'house',
  character: 'Deep-red atmosphere, warm-white grotesque type, one hot accent, glass cards; motion that arrives, explains, then holds.',
  industries: ['creator channels', 'education', 'explainers'],
  c: ['#100607', '#1a0407', '#f7f2ee', '#c8a5a3', '#b32639', '#d34b55', '#e9879e'],
  gradient: { angle: 160, stops: ['#1c0000', '#250707', '#5d1416'] },
  type: { display: 'Inter', weight: 700, tracking: '-0.05em', casing: 'none', heading: 'Inter', body: 'Inter', caption: 'Inter' },
  motion: { easing: EASE.out, enter: 0.66, exit: 0.25, hold: 1.8, stagger: 0.1, intensity: 'balanced', transitions: ['cut', 'push', 'occluder'] },
  imagery: { style: 'Warm, natural skin against a dark red field; only graphics carry the burgundy grade.', sat: 0, con: 0.1, warm: 0.15, icons: 'line', prefix: 'cinematic, warm natural light, dark burgundy environment, shallow depth of field,', negative: NEG + ', blue mint SaaS look, decorative blobs' },
  voice: { tone: ['direct', 'warm', 'confident'], use: ['one idea per sentence', 'plain verbs'], avoid: ['hype adjectives', 'jargon', 'exclamation marks'], samples: ['Motion follows meaning.', 'One idea per frame. Then a hold.', 'Cut on the word, not the clock.'] },
  audio: { music: 'warm analogue synth bed, low, unhurried', tempo: [80, 100], sfx: ['soft whoosh', 'tick', 'low impact + air'] },
});

// ── the researched style archetypes (archetypes.json) ────────────────────────

type Researched = (typeof research)[number];

const grade = (n: number) => Math.max(-1, Math.min(1, Math.abs(n) > 1 ? n / 100 : n));
const icons = (text: string): string => {
  const t = text.toLowerCase();
  if (t.includes('duotone')) return 'duotone';
  if (t.includes('3d')) return '3d';
  if (t.includes('hand')) return 'hand-drawn';
  if (t.includes('filled') || t.includes('solid')) return 'filled';
  if (t.includes('flat')) return 'flat';
  if (t.includes('outline') || t.includes('line') || t.includes('stroke')) return 'line';
  return 'custom';
};
const casing = (v: string): 'none' | 'uppercase' | 'lowercase' | 'capitalize' => (['uppercase', 'lowercase', 'capitalize'].includes(v) ? (v as 'uppercase' | 'lowercase' | 'capitalize') : 'none');
const intensity = (v: string): MotionIntensity => (v === 'calm' || v === 'energetic' ? v : 'balanced');
const corner = (v: string): Corner => ((['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] as const).find((c) => c === v) ?? 'top-right');
const lowerThird = (v: string): BrandLayout['lowerThird'] => ((['bottom-left', 'bottom-right', 'bottom-center'] as const).find((c) => c === v) ?? 'bottom-left');
const captions = (v: string): BrandLayout['captions'] => ((['bottom-center', 'top-center', 'center', 'lower-third-side'] as const).find((c) => c === v) ?? 'bottom-center');
const hex = (v: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);
/** Families Helios resolves by installed name; research names are mapped onto them. */
const FAMILY_ALIASES: Record<string, string> = { palatino: 'Palatino Linotype', 'palatino linotype': 'Palatino Linotype', times: 'Times New Roman', 'times new roman': 'Times New Roman', courier: 'Courier New', 'courier new': 'Courier New', helvetica: 'Helvetica', 'helvetica neue': 'Helvetica', 'segoe ui': 'Segoe UI', 'arial black': 'Arial Black', 'trebuchet ms': 'Trebuchet MS', 'jetbrains mono': 'JetBrains Mono', 'cascadia code': 'Cascadia Code', 'segoe ui black': 'Segoe UI Black' };
const KNOWN = ['Inter', 'Segoe UI', 'Arial', 'Helvetica', 'Arial Black', 'Impact', 'Trebuchet MS', 'Verdana', 'Tahoma', 'Calibri', 'Candara', 'Georgia', 'Cambria', 'Palatino Linotype', 'Garamond', 'Times New Roman', 'Consolas', 'Courier New', 'Cascadia Code', 'JetBrains Mono', 'Segoe UI Black'];
const family = (v: string): string => KNOWN.includes(v) ? v : FAMILY_ALIASES[v.trim().toLowerCase()] ?? 'Inter';

const fromResearch = (r: Researched): BrandArchetype => ({
  id: r.id,
  name: r.name,
  group: 'archetype',
  character: r.character,
  industries: r.industries,
  colors: {
    bg: hex(r.colors.bg, '#0a0a0a'), surface: hex(r.colors.surface, '#141414'), text: hex(r.colors.text, '#f5f5f5'), muted: hex(r.colors.muted, '#8a8a8a'),
    primary: hex(r.colors.primary, '#d34b55'), accent: hex(r.colors.accent, '#d34b55'), accent2: hex(r.colors.accent2, '#e9879e'),
  },
  gradient: { angle: r.gradient.angle, stops: r.gradient.stops.map((s) => hex(s, '#d34b55')) },
  typography: {
    display: { family: family(r.typography.display.family), weight: r.typography.display.weight, letterSpacing: r.typography.display.letterSpacing, transform: casing(r.typography.display.transform) },
    heading: { family: family(r.typography.heading.family), weight: r.typography.heading.weight },
    body: { family: family(r.typography.body.family), weight: r.typography.body.weight },
    caption: { family: family(r.typography.caption.family), weight: r.typography.caption.weight },
  },
  motion: { easing: r.motion.easing, enter: r.motion.enter, exit: r.motion.exit, hold: r.motion.hold, stagger: r.motion.stagger, intensity: intensity(r.motion.intensity), transitions: r.motion.transitions },
  imagery: { style: r.imagery.style, grade: { saturation: grade(r.imagery.grade.saturation), contrast: grade(r.imagery.grade.contrast), warmth: grade(r.imagery.grade.warmth) }, iconography: icons(r.imagery.iconography), promptPrefix: r.imagery.promptPrefix, negativePrompt: r.imagery.negativePrompt },
  voice: { tone: r.voice.tone, use: r.voice.use, avoid: r.voice.avoid, samples: r.voice.samples },
  layout: { safeMargin: r.layout.safeMargin, logoBug: corner(r.layout.logoBug), lowerThird: lowerThird(r.layout.lowerThird), captions: captions(r.layout.captions) },
  audio: { music: r.audio.music, tempo: [r.audio.tempo[0], r.audio.tempo[1]], sfx: r.audio.sfx },
});

export const STYLE_ARCHETYPES: BrandArchetype[] = research.map(fromResearch);

// ── reference kits rebuilt from public brand shots (Dribbble "full branding kit", 2025–26) ───────

const REF = (s: Omit<Spec, 'group'>): BrandArchetype => define({ ...s, group: 'reference' });
const refMotion = (intensity: MotionIntensity, transitions: string[]) => (intensity === 'energetic'
  ? { easing: EASE.snap, enter: 0.4, exit: 0.2, hold: 1.6, stagger: 0.06, intensity, transitions }
  : intensity === 'calm'
    ? { easing: EASE.glide, enter: 0.9, exit: 0.4, hold: 2.5, stagger: 0.14, intensity, transitions }
    : { easing: EASE.out, enter: 0.55, exit: 0.25, hold: 1.8, stagger: 0.08, intensity, transitions });
const GROTESK = { display: 'Inter', weight: 800, tracking: '-0.04em', casing: 'none' as const, heading: 'Inter', body: 'Segoe UI', caption: 'Inter' };

export const REFERENCE_KITS: BrandArchetype[] = [
  REF({ id: 'ref-luban', name: 'Luban (reference)', character: 'Burnt orange on black with warm tan; geometric L mark; conversational-AI confidence.', industries: ['conversational AI', 'call intelligence', 'B2B'], c: ['#0e0e0e', '#1c1c1c', '#ffffff', '#a8a29e', '#ff7a1a', '#ff9a4d', '#f3e7d9'], type: GROTESK, motion: refMotion('balanced', ['cut', 'push']), imagery: { style: 'Dark studio product shots, orange accents, 3D letterforms, robot-and-human portraits.', sat: 0.1, con: 0.15, warm: 0.2, icons: 'filled', prefix: 'dark studio, burnt orange accent lighting, 3D letterform, matte black,', negative: NEG }, voice: { tone: ['direct', 'sharp'], use: ['every call', 'we read it'], avoid: ['fluff'], samples: ['Talk happens fast. We keep it smart.', 'Every call leaves a clue. We read it.'] }, audio: { music: 'minimal electronic', tempo: [95, 115], sfx: ['tick', 'whoosh'] } }),
  REF({ id: 'ref-capway', name: 'Capway (reference)', character: 'Navy field, cyan and blue ribbons, chrome 3D C; coaching-growth SaaS.', industries: ['fitness-coach SaaS', 'B2B growth', 'coaching'], c: ['#0b1a4a', '#122a6b', '#ffffff', '#9fb0d6', '#2563eb', '#22d3ee', '#5b8def'], gradient: { angle: 135, stops: ['#2563eb', '#22d3ee'] }, type: GROTESK, motion: refMotion('balanced', ['push', 'cut']), imagery: { style: 'Chrome ribbons, navy gradients, confident portraits in dark tees.', sat: 0.1, con: 0.15, warm: -0.15, icons: 'filled', prefix: 'navy studio, chrome ribbon 3D shape, cyan rim light,', negative: NEG }, voice: { tone: ['confident', 'plain'], use: ['same effort, bigger results'], avoid: ['jargon'], samples: ['You coach people. We handle the growth.', 'Same effort. Bigger results.'] }, audio: { music: 'clean electronic', tempo: [100, 120], sfx: ['whoosh', 'tick'] } }),
  REF({ id: 'ref-unlok', name: 'Unlok (reference)', character: 'Vivid orange, black and warm tan with a mint touch; rounded U mark; wealth made friendly.', industries: ['wealth', 'investing', 'fintech'], c: ['#111111', '#1f1f1f', '#ffffff', '#b8ad9e', '#ff6a2b', '#ff8a4d', '#e9d8c4'], type: { ...GROTESK, casing: 'lowercase' }, motion: refMotion('balanced', ['cut', 'zoom-punch']), imagery: { style: 'Portraits on tan and orange fields; holding a mark; leopard texture accents.', sat: 0.15, con: 0.1, warm: 0.25, icons: 'filled', prefix: 'warm studio portrait, orange and tan backdrop, bold graphic,', negative: NEG }, voice: { tone: ['friendly', 'confident'], use: ['let the experts trade'], avoid: ['risk-free'], samples: ['Let the experts trade. You enjoy life.', 'Money has a path. We help you find it.'] }, audio: { music: 'warm pop electronic', tempo: [100, 120], sfx: ['pop', 'coin'] } }),
  REF({ id: 'ref-hurst', name: 'Hurst (reference)', character: 'Electric blue, volt yellow, black and white; monospaced tags; IT that stays calm.', industries: ['IT services', 'security', 'monitoring'], c: ['#0d0d0d', '#1a1a1a', '#ffffff', '#9a9a9a', '#1f3bff', '#f5ff2a', '#4d5dff'], gradient: { angle: 135, stops: ['#1f3bff', '#f5ff2a'] }, type: { ...GROTESK, caption: 'Consolas' }, motion: refMotion('balanced', ['cut', 'wipe']), imagery: { style: 'Blue and yellow colour blocks, brushed metal, armour-suit humour.', sat: 0.2, con: 0.2, warm: -0.1, icons: 'line', prefix: 'electric blue and yellow colour blocking, brushed metal texture, bold graphic,', negative: NEG }, voice: { tone: ['calm', 'dry', 'competent'], use: ['we stay calm', 'downtime'], avoid: ['panic'], samples: ['When systems panic, we stay calm.', 'Your downtime is our enemy.', 'Bugs run fast. We run faster.'] }, audio: { music: 'tight electronic', tempo: [100, 125], sfx: ['tick', 'alert'] } }),
  REF({ id: 'ref-realest', name: 'Realest (reference)', character: 'Cream paper with red, green and sky blocks; grid-built R; real estate that says less.', industries: ['real estate', 'property', 'agency'], c: ['#f4efe6', '#ffffff', '#111111', '#6f6a63', '#e0383a', '#1d7a4a', '#6fb1d8'], gradient: { angle: 90, stops: ['#e0383a', '#1d7a4a', '#6fb1d8'] }, type: { ...GROTESK, weight: 700 }, motion: refMotion('balanced', ['cut', 'wipe']), imagery: { style: 'Architecture photography, colour-block panels, people with keys.', sat: 0.05, con: 0.1, warm: 0.1, icons: 'line', prefix: 'modern architecture photograph, colour block panels, clean daylight,', negative: NEG }, voice: { tone: ['plain', 'assured'], use: ['say less', 'clear guidance'], avoid: ['dream home clichés'], samples: ['Say less. Buy smart.', 'Big step. Clear guidance.', 'We don\'t sell homes. We sell dreams.'] }, audio: { music: 'light acoustic pop', tempo: [90, 110], sfx: ['click', 'key'] } }),
  REF({ id: 'ref-bridze', name: 'Bridze (reference)', character: 'Hot pink-red, black and lavender; angular B; bridge-between-you-and-clients marketing.', industries: ['marketing', 'agency', 'lead gen'], c: ['#111111', '#1b1b1b', '#ffffff', '#b9b0c9', '#ff2d55', '#ff5c7a', '#d7c8ff'], type: GROTESK, motion: refMotion('energetic', ['cut', 'push', 'zoom-punch']), imagery: { style: 'Pink-red and lavender blocks, 3D mark, tote and watch mockups.', sat: 0.2, con: 0.15, warm: 0, icons: 'filled', prefix: 'hot pink and lavender graphic, 3D logo render, bold contrast,', negative: NEG }, voice: { tone: ['bold', 'direct'], use: ['bridge', 'best clients'], avoid: ['synergy'], samples: ['Bridge between you and your best clients.', 'Your audience isn\'t far. You just need a bridge.'] }, audio: { music: 'punchy pop electronic', tempo: [105, 125], sfx: ['whoosh', 'pop'] } }),
  REF({ id: 'ref-fisgo', name: 'Fisgo.ai (reference)', character: 'Red, orange and pink on black and cream; play-button mark; AI cuts the video.', industries: ['AI video', 'creator tools', 'SaaS'], c: ['#0f0f0f', '#1a1a1a', '#ffffff', '#b8b0ad', '#ff2d2d', '#ff7a1a', '#ffb3c1'], gradient: { angle: 120, stops: ['#ff2d2d', '#ff7a1a', '#ffb3c1'] }, type: GROTESK, motion: refMotion('energetic', ['cut', 'zoom-punch']), imagery: { style: 'Creator portraits, waveform graphics, red-orange gradients.', sat: 0.2, con: 0.15, warm: 0.15, icons: 'filled', prefix: 'creator studio, red and orange gradient light, audio waveform graphic,', negative: NEG }, voice: { tone: ['punchy', 'confident'], use: ['you bring the idea'], avoid: ['hedging'], samples: ['AI cuts the video. You cut the time.', 'You bring the idea. We shape the story.'] }, audio: { music: 'upbeat electronic', tempo: [110, 130], sfx: ['click', 'whoosh'] } }),
  REF({ id: 'ref-senda', name: 'Senda (reference)', character: 'Deep purple to violet with black and white; S mark; borderless payments.', industries: ['payments', 'fintech', 'cards'], c: ['#0d0716', '#1a0f2e', '#ffffff', '#b3a6d6', '#5b2bd6', '#8b5cf6', '#c4b5fd'], gradient: { angle: 135, stops: ['#5b2bd6', '#8b5cf6'] }, type: { ...GROTESK, weight: 700 }, motion: refMotion('balanced', ['push', 'cut']), imagery: { style: 'Purple gradient cards, hands holding devices, glass S mark.', sat: 0.15, con: 0.15, warm: -0.2, icons: 'filled', prefix: 'purple gradient studio, glass 3D letter, card and watch mockup,', negative: NEG }, voice: { tone: ['calm', 'confident'], use: ['no borders'], avoid: ['fees hidden'], samples: ['No borders. No barriers. No stress.', 'Fast payments. Zero drama.'] }, audio: { music: 'smooth electronic', tempo: [95, 115], sfx: ['tick', 'chime'] } }),
  REF({ id: 'ref-fastep', name: 'Fastep (reference)', character: 'Acid lime on charcoal with sand; arrow-step mark; business is a race.', industries: ['consulting', 'B2B services', 'strategy'], c: ['#1a1a1a', '#262626', '#ffffff', '#a3a3a3', '#c8ff3d', '#d9ff70', '#d9c7a3'], type: GROTESK, motion: refMotion('energetic', ['cut', 'whip']), imagery: { style: 'Lime signage, concrete, blurred motion, laptop-at-work portraits.', sat: 0.15, con: 0.2, warm: 0, icons: 'filled', prefix: 'acid lime graphic on concrete, motion blur, urban,', negative: NEG }, voice: { tone: ['fast', 'decisive'], use: ['shortcut', 'momentum'], avoid: ['slow'], samples: ['Business is a race. We are the shortcut.', 'The power of presence.'] }, audio: { music: 'driving beat', tempo: [120, 140], sfx: ['whoosh', 'hit'] } }),
  REF({ id: 'ref-tracko', name: 'Tracko (reference)', character: 'Royal blue with yellow and pale blue; puzzle-cube motif; data made clear.', industries: ['analytics', 'data', 'dashboards'], c: ['#0b1f66', '#1e63ff', '#ffffff', '#c9dcff', '#1e63ff', '#ffd23f', '#c9dcff'], gradient: { angle: 135, stops: ['#1e63ff', '#ffd23f'] }, type: GROTESK, motion: refMotion('balanced', ['cut', 'push']), imagery: { style: 'Blue panels, yellow highlights, colour cubes, headphones-and-data portraits.', sat: 0.15, con: 0.1, warm: 0, icons: 'filled', prefix: 'royal blue studio, yellow highlight, colourful cube graphic,', negative: NEG }, voice: { tone: ['clear', 'reassuring'], use: ['data is a puzzle'], avoid: ['noise'], samples: ['Raw data is noise. We make it music.', 'Data is a puzzle. We make it clear.', 'Markets change like storms. We are the lighthouse.'] }, audio: { music: 'clean pop electronic', tempo: [100, 120], sfx: ['tick', 'click'] } }),
  REF({ id: 'ref-regrow', name: 'Regrow (reference)', character: 'Blue and orange with sky and black; R mark; fear less, grow more.', industries: ['wealth', 'savings', 'fintech'], c: ['#0f0f0f', '#1a1a1a', '#ffffff', '#a3a3a3', '#1856ff', '#ff6a00', '#3fa7ff'], gradient: { angle: 90, stops: ['#1856ff', '#3fa7ff', '#ff6a00'] }, type: GROTESK, motion: refMotion('balanced', ['cut', 'push']), imagery: { style: 'Blue gradients, orange numerals, portraits, colour stripes.', sat: 0.15, con: 0.1, warm: 0, icons: 'filled', prefix: 'blue gradient backdrop, orange accent numerals, 3D R mark,', negative: NEG }, voice: { tone: ['encouraging', 'plain'], use: ['fear less', 'grow more'], avoid: ['guaranteed'], samples: ['Fear less. Grow more.', 'Money resting? Let it Regrow.'] }, audio: { music: 'uplifting electronic', tempo: [100, 120], sfx: ['chime', 'whoosh'] } }),
  REF({ id: 'ref-lunchlane', name: 'Lunchlane (reference)', character: 'Orange, yellow and black with a red stripe; stacked L mark; launches find their lane.', industries: ['launch platform', 'productivity', 'apps'], c: ['#111111', '#1c1c1c', '#ffffff', '#b3b3b3', '#ff6a00', '#ffc700', '#e02020'], gradient: { angle: 90, stops: ['#ff6a00', '#ffc700'] }, type: { ...GROTESK, casing: 'uppercase', tracking: '-0.03em' }, motion: refMotion('energetic', ['cut', 'wipe']), imagery: { style: 'Orange and yellow blocks, phone and watch mockups, portraits with tablets.', sat: 0.2, con: 0.15, warm: 0.2, icons: 'filled', prefix: 'orange and yellow colour blocking, product mockup, bright,', negative: NEG }, voice: { tone: ['upbeat', 'direct'], use: ['launch', 'lane'], avoid: ['someday'], samples: ['Where every launch finds its lane.'] }, audio: { music: 'bright pop', tempo: [110, 130], sfx: ['pop', 'whoosh'] } }),
  REF({ id: 'ref-fewtech', name: 'Fewtech (reference)', character: 'Olive, orange and black with white; pixel-grid F; outline wordmark.', industries: ['tech', 'IT', 'startups'], c: ['#000000', '#141414', '#ffffff', '#a3a3a3', '#b7c880', '#ff7a1a', '#ffffff'], gradient: { angle: 135, stops: ['#b7c880', '#ff7a1a'] }, type: { ...GROTESK, casing: 'uppercase', tracking: '0.02em' }, motion: refMotion('balanced', ['cut', 'pixel']), imagery: { style: 'Olive and orange colour cards, pin badges, phone icons.', sat: 0.1, con: 0.15, warm: 0.1, icons: 'flat', prefix: 'olive and orange flat graphic, pixel grid motif, badges,', negative: NEG }, voice: { tone: ['minimal', 'techy'], use: ['few', 'fast'], avoid: ['bloat'], samples: ['Few tools. More done.'] }, audio: { music: 'minimal techno', tempo: [110, 128], sfx: ['click', 'pixel blip'] } }),
  REF({ id: 'ref-kozymart', name: 'Kozymart (reference)', character: 'Vivid orange with black and white; bag-with-K mark; cosy retail.', industries: ['retail', 'e-commerce', 'grocery'], c: ['#111111', '#1c1c1c', '#ffffff', '#b3b3b3', '#ff6a1a', '#ffb37a', '#ffffff'], gradient: { angle: 135, stops: ['#ff6a1a', '#ffb37a'] }, type: { ...GROTESK, tracking: '-0.03em' }, motion: refMotion('balanced', ['cut', 'pop']), imagery: { style: 'Orange storefronts, stickers, shopping bags, bright daylight.', sat: 0.2, con: 0.1, warm: 0.25, icons: 'flat', prefix: 'bright orange retail branding, shopping bag mockup, sticker roll, daylight,', negative: NEG }, voice: { tone: ['warm', 'helpful'], use: ['cosy', 'everyday'], avoid: ['luxury'], samples: ['Everyday, made cosy.'] }, audio: { music: 'cheerful pop', tempo: [100, 120], sfx: ['pop', 'ding'] } }),
  REF({ id: 'ref-wodex', name: 'Wodex (reference)', character: 'Orange-to-yellow gradient on near-black; sunburst mark; powering what moves (printed hex #FDBB01 / #FE5106 / #070707).', industries: ['energy', 'EV', 'automotive'], c: ['#070707', '#1a0f04', '#ffffff', '#c9a98a', '#fe5106', '#fdbb01', '#ff8a3d'], gradient: { angle: 100, stops: ['#fe5106', '#fdbb01'] }, type: { display: 'Arial Black', weight: 900, tracking: '0.04em', casing: 'uppercase', heading: 'Inter', body: 'Segoe UI', caption: 'Inter', headingWeight: 800 }, motion: refMotion('energetic', ['cut', 'zoom-punch', 'flash']), imagery: { style: 'Gradient light streaks, sunburst, dark cards, glowing edges.', sat: 0.25, con: 0.2, warm: 0.3, icons: 'filled', prefix: 'orange to yellow gradient light streaks, dark background, sunburst emblem, glowing edges,', negative: NEG }, voice: { tone: ['powerful', 'forward'], use: ['power', 'move'], avoid: ['slow'], samples: ['Powering what moves the future.'] }, audio: { music: 'cinematic electronic', tempo: [110, 135], sfx: ['engine', 'whoosh', 'hit'] } }),
  REF({ id: 'ref-sherly-moore', name: 'Sherly Moore (reference)', character: 'Burgundy script on cream with forest green and sage; personal, elegant, floral.', industries: ['personal brand', 'florist', 'wedding', 'beauty'], c: ['#efe4d2', '#f7efe3', '#3a1f24', '#8a6f72', '#6b1f2a', '#1f3d2b', '#cfd8c8'], gradient: { angle: 160, stops: ['#6b1f2a', '#1f3d2b'] }, type: { display: 'Georgia', weight: 400, tracking: '0.01em', casing: 'none', heading: 'Georgia', body: 'Segoe UI', caption: 'Segoe UI', headingWeight: 400 }, motion: refMotion('calm', ['dissolve']), imagery: { style: 'Roses, hands, cream paper, burgundy and forest textiles, soft window light.', sat: -0.05, con: 0, warm: 0.2, icons: 'hand-drawn', prefix: 'soft window light, burgundy and cream palette, roses and linen, elegant script,', negative: NEG + ', neon, tech' }, voice: { tone: ['elegant', 'personal', 'warm'], use: ['by hand', 'for you'], avoid: ['corporate'], samples: ['Made with care, signed by hand.', 'For the days that matter.'] }, audio: { music: 'solo piano, strings', tempo: [60, 85], sfx: ['paper', 'petal'] } }),
];

export const ARCHETYPES: BrandArchetype[] = [HOUSE_ARCHETYPE, ...STYLE_ARCHETYPES, ...REFERENCE_KITS];

const byId = new Map(ARCHETYPES.map((a) => [a.id, a]));

/** Accepts an id, a name, or a loose word ("luxury", "neon", "luban"). */
export function findArchetype(query: string | null | undefined): BrandArchetype | undefined {
  if (!query) return undefined;
  const key = query.trim().toLowerCase();
  if (!key) return undefined;
  const kebab = key.replace(/[\s_]+/g, '-');
  return byId.get(kebab) ?? byId.get(`ref-${kebab}`) ?? ARCHETYPES.find((a) => a.name.toLowerCase() === key) ?? ARCHETYPES.find((a) => a.id.includes(kebab) || a.name.toLowerCase().includes(key) || a.character.toLowerCase().includes(key));
}

/** One line per archetype for the model. */
export const archetypeCatalogue = (group?: BrandArchetype['group']): string =>
  ARCHETYPES.filter((a) => !group || a.group === group).map((a) => `- ${a.id} [${a.group}] ${a.name}: ${a.character} Colours ${a.colors.bg} / ${a.colors.primary} / ${a.colors.accent}. Type ${a.typography.display.family} ${a.typography.display.weight}. Motion ${a.motion.intensity}. For ${a.industries.join(', ')}.`).join('\n');
