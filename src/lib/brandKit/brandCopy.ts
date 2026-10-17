// The words a brand film may print: never the kit's style description (that is a design note such as
// "Black, gold and bordeaux; slow, generous, serif-led", not something a brand says).
//
// In order: the kit's own tagline, a line from its voice samples, a line composed from its name,
// values and industry, and finally the name alone.
import type { BrandKit } from './types';

export type BrandCopy = {
  name: string;
  /** One short line under the logo and on end cards. */
  tagline: string;
  /** The line a title or statement card carries (a different sample than the tagline when the voice has two). */
  headline: string;
  /** Where the tagline came from, for tests and the studio: "tagline" | "voice" | "composed" | "name". */
  source: 'tagline' | 'voice' | 'composed' | 'name';
};

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const words = (text: string) => squash(text).split(' ').filter(Boolean).length;
const norm = (text: string) => squash(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Whether `line` is (or is lifted from) the kit's style description or archetype character. */
function isDesignNote(kit: BrandKit, line: string): boolean {
  const l = norm(line);
  if (!l) return true;
  const notes = [kit.description, kit.imagery?.style].filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map(norm);
  return notes.some((n) => n === l || (l.length >= 14 && n.includes(l)) || (n.length >= 14 && l.includes(n)));
}

/** A voice sample that works as a short on-screen line: 2–9 words, 6–64 characters, not a design note. */
function sampleLines(kit: BrandKit): string[] {
  const lines = (kit.voiceGuide?.samples ?? []).map(squash).filter((s) => s.length >= 6 && s.length <= 64 && words(s) >= 2 && words(s) <= 9 && !isDesignNote(kit, s));
  return [...lines].sort((a, b) => Math.abs(words(a) - 5) - Math.abs(words(b) - 5));
}

function composed(kit: BrandKit): string | null {
  const name = squash(kit.name);
  const values = (kit.values ?? []).map(squash).filter((v) => v && v.length <= 18 && words(v) <= 2);
  if (values.length >= 2) return `${cap(values[0])}. ${cap(values[1])}. ${name}.`;
  const industry = squash(kit.industry ?? '');
  if (industry && industry.length <= 32 && !isDesignNote(kit, industry)) return `${name} — made for ${industry.toLowerCase()}`;
  return null;
}

export function brandCopy(kit: BrandKit): BrandCopy {
  const name = squash(kit.name) || 'Brand';
  const own = squash(kit.tagline ?? '');
  const samples = sampleLines(kit);
  const ownOk = own && !isDesignNote(kit, own);
  let tagline = name;
  let source: BrandCopy['source'] = 'name';
  if (ownOk) { tagline = own; source = 'tagline'; }
  else if (samples[0]) { tagline = samples[0]; source = 'voice'; }
  else {
    const line = composed(kit);
    if (line) { tagline = line; source = 'composed'; }
  }
  // A statement card wants a different line than the tagline when the voice offers one.
  const headline = (source === 'tagline' ? samples[0] : samples[1]) ?? tagline;
  return { name, tagline, headline: words(headline) > 9 ? tagline : headline, source };
}
