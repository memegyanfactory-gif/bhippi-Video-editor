// Who the video is for: the viewers' country (an ISO 3166 code: IN, BR, JP…) or `global`, the
// English-speaking internet at large. It decides which memes the edit may use and where they are
// searched for: a local meme only lands with viewers who grew up on it, so viewers get their own
// country's memes and global ones — plus the few local ones that crossed over and the whole
// internet knows.
//
// Read from what is said, strongest signal first:
//   · A script only one country writes: Devanagari (IN), Hangul (KR), Japanese kana (JP), Thai (TH).
//   · Roman Hinglish function words (hai, nahi, kya, bhai, yaar…) — the grammar of a Hinglish
//     sentence, which English never uses. Words that are also English ("do", "par", "ho") are left out.
//   · Indian references (₹, lakh, crore, Bollywood, IPL…) — weak on their own: a US video can
//     mention Bollywood.
// Anything else reads as global; the AI (or the user) sets the country when the speech is plainly
// another country's (Brazilian Portuguese → BR).

/** `global`, or the viewers' country as an upper-case ISO 3166 alpha-2 code (`IN`, `BR`, `US`…). */
export type Audience = string;

/** How a report names an audience: "a global audience", "Indian viewers", "viewers in Brazil". */
export function audienceLabel(audience: Audience): string {
  if (audience === 'global') return 'a global audience';
  if (audience === 'IN') return 'Indian viewers';
  let name = audience;
  try {
    name = new Intl.DisplayNames(['en'], { type: 'region' }).of(audience) ?? audience;
  } catch {
    // A runtime without DisplayNames: the code will do.
  }
  return `viewers in ${name}`;
}

/** Scripts only one country's viewers write (Devanagari is read with Hinglish, below). */
const SCRIPTS: [Audience, string, RegExp][] = [
  ['KR', 'Hangul', /[ᄀ-ᇿ㄰-㆏가-힯]/u],
  ['JP', 'Japanese kana', /[぀-ヿ]/u],
  ['TH', 'Thai', /[฀-๿]/u],
];

export type AudienceReading = {
  audience: Audience;
  /** 0–1: how sure the reading is (1 for a Hindi transcript, low for a borderline one). */
  confidence: number;
  /** Why, in words, for the AI's report. */
  signals: string[];
};

const HINGLISH = new Set([
  'hai', 'hain', 'nahi', 'nahin', 'nhi', 'kya', 'kyun', 'kyu', 'kyon', 'bhai', 'bhaiya', 'yaar', 'matlab', 'bhi', 'kaise', 'kaisa', 'kaisi',
  'accha', 'acha', 'achha', 'theek', 'thik', 'sab', 'sabko', 'mera', 'meri', 'mere', 'tera', 'teri', 'tere', 'tumhara', 'aap', 'aapka', 'hum', 'humko',
  'woh', 'wo', 'yeh', 'karo', 'karna', 'karke', 'raha', 'rahi', 'rahe', 'gaya', 'gayi', 'gaye', 'bohot', 'bahut', 'paisa', 'paise', 'arre', 'abhi',
  'chalo', 'dekho', 'dekh', 'bolo', 'bol', 'sirf', 'lekin', 'aur', 'hoga', 'hogi', 'wala', 'wali', 'wale', 'kuch', 'koi', 'kaun', 'kahan', 'kab',
  'phir', 'fir', 'haan', 'nahi', 'ji', 'beta', 'didi', 'mujhe', 'tujhe', 'usko', 'isko', 'unko', 'hota', 'hoti', 'kiya', 'kiye', 'diya', 'liya',
  'dost', 'log', 'logon', 'bilkul', 'shayad', 'zindagi', 'duniya', 'samjha', 'samjho', 'pata', 'chahiye', 'jaldi', 'thoda', 'zyada', 'waise',
]);

const INDIAN_REFERENCES = /₹|\b(?:rupees?|rs\.?\s?\d|lakh|lakhs|crore|crores|bollywood|tollywood|ipl|diwali|holi|desi|chai|mumbai|delhi|bengaluru|bangalore|kolkata|hyderabad|chennai|pune|jio|flipkart|zomato|swiggy|paytm|upsc|jee|neet|sarkari|shaadi|mummy ji|papa ji)\b/gi;

/**
 * Reads the audience from spoken text (a transcript, a beat sheet's lines). Needs a few sentences
 * to be sure; with almost nothing to read it says global with low confidence.
 */
export function detectAudience(texts: string[]): AudienceReading {
  const text = texts.join(' ');
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch));
  const devanagari = letters.filter((ch) => /[ऀ-ॿ]/.test(ch)).length;
  const devanagariShare = letters.length ? devanagari / letters.length : 0;
  const words = text.toLowerCase().normalize('NFKD').match(/[a-z]+/g) ?? [];
  const hinglish = words.filter((word) => HINGLISH.has(word)).length;
  const hinglishShare = words.length ? hinglish / words.length : 0;
  const references = (text.match(INDIAN_REFERENCES) ?? []).length;
  const signals: string[] = [];
  if (devanagari) signals.push(`${Math.round(devanagariShare * 100)}% of the letters are Devanagari`);
  if (hinglish) signals.push(`${hinglish} Hinglish words (${Math.round(hinglishShare * 100)}% of the Roman words)`);
  if (references) signals.push(`${references} Indian references (₹, lakh, Bollywood…)`);
  for (const [country, name, script] of SCRIPTS) {
    const share = letters.length ? letters.filter((ch) => script.test(ch)).length / letters.length : 0;
    if (share >= 0.1 && share > devanagariShare) return { audience: country, confidence: Math.min(1, 0.6 + share), signals: [`${Math.round(share * 100)}% of the letters are ${name}`] };
  }

  if (devanagariShare >= 0.05) return { audience: 'IN', confidence: Math.min(1, 0.6 + devanagariShare), signals };
  if (hinglishShare >= 0.05 && hinglish >= 3) return { audience: 'IN', confidence: Math.min(1, 0.5 + hinglishShare * 3), signals };
  if (references >= 3 && hinglish >= 1) return { audience: 'IN', confidence: 0.55, signals };
  const enough = words.length >= 40;
  if (!signals.length) signals.push(enough ? 'English with no Hindi, Hinglish or Indian references' : 'too little speech to be sure; treated as global');
  return { audience: 'global', confidence: enough ? Math.max(0.5, 0.95 - hinglishShare * 6 - references * 0.05) : 0.3, signals };
}

/** Whether a meme suits an audience: global memes and crossovers suit everyone; a local meme only its own country. */
export function memeFitsAudience(entry: { region: string; crossover?: boolean }, audience: Audience): boolean {
  return entry.region === 'global' || entry.crossover === true || entry.region.toUpperCase() === audience;
}

// ─── The audience a comp is edited for ────────────────────────────────────────────────────────

/** What the roast planner keeps on the comp: the audience, and whether the user chose it. */
export type AudienceSetting = AudienceReading & { source: 'detected' | 'user' };

/**
 * The audience a comp's edit is for: the one set on it (by the user, or detected when the beat
 * sheet was saved), else read from its beat sheet now, else null (nothing to go on yet).
 */
export function compAudience(comp: { roast?: { audience?: AudienceSetting; beatSheet?: { beats: { text: string }[] } } }): Audience | null {
  const set = comp.roast?.audience;
  if (set) return set.audience;
  const beats = comp.roast?.beatSheet?.beats ?? [];
  return beats.length ? detectAudience(beats.map((beat) => beat.text)).audience : null;
}

/** Country names people type instead of a code. */
const COUNTRY_NAMES: Record<string, Audience> = {
  india: 'IN', indian: 'IN', usa: 'US', america: 'US', american: 'US', uk: 'GB', britain: 'GB', british: 'GB', england: 'GB',
  brazil: 'BR', brazilian: 'BR', mexico: 'MX', mexican: 'MX', spain: 'ES', japan: 'JP', japanese: 'JP', korea: 'KR', korean: 'KR',
  philippines: 'PH', filipino: 'PH', indonesia: 'ID', nigeria: 'NG', pakistan: 'PK', germany: 'DE', france: 'FR', italy: 'IT',
};

/** An `audience` tool argument: global, a country code (or a common country name), or auto/absent (null). */
export function audienceArg(value: unknown): Audience | 'auto' | null | 'bad' {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return 'bad';
  const text = value.trim().toLowerCase();
  if (text === 'global' || text === 'international' || text === 'world' || text === 'worldwide') return 'global';
  if (text === 'auto') return 'auto';
  if (COUNTRY_NAMES[text]) return COUNTRY_NAMES[text];
  if (/^[a-z]{2}$/.test(text)) return text.toUpperCase();
  return 'bad';
}

/** What a bad `audience` argument is told. */
export const AUDIENCE_HINT = 'audience must be global, a two-letter country code (IN, US, GB, BR, MX, JP…) or auto.';

/**
 * The memes in a plan that its audience would not recognise: another country's local memes that
 * never crossed over. `get` reads a meme from the library (null when unknown).
 */
export async function memeAudienceErrors(
  memeIds: string[],
  audience: Audience | null,
  get: (id: string) => Promise<{ name: string; region: string; crossover?: boolean } | null>,
): Promise<string[]> {
  if (!audience) return [];
  const errors: string[] = [];
  for (const id of [...new Set(memeIds)]) {
    const entry = await Promise.resolve().then(() => get(id)).catch(() => null);
    if (entry && !memeFitsAudience(entry, audience)) {
      errors.push(`meme ${id} ("${entry.name}") is a local meme from ${entry.region} and this video is for ${audienceLabel(audience)}, who would not recognise it: swap it for one they know (search_memes and find_memes_online with this audience)`);
    }
  }
  return errors;
}
