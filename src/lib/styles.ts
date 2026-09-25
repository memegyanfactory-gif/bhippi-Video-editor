// Edit styles: a named grammar the chat switches on with an `@` tag (docs/FUNNY-MODE-PLAN.md §3.1).
//
// A reference (`@name` of a film on disk) says "edit like that film"; a style says "edit in this
// grammar". A style bundles:
//   - a persona the turn works under, and the brief the backend puts in the system prompt
//     (src-tauri/prompts/styles/<id>.md, chosen by `editStyle` in the turn's context — chat.rs);
//   - the council seat that reviews the result (src/lib/council.ts);
//   - the Edit DNA band the result is measured against (src/lib/roast/dna.ts).
// '@funny' is the first. Another ('@documentary', '@hype') is one more entry here plus its brief.

import type { CouncilRole } from './council';
import { FUNNY_BAND, type DnaBand } from './roast/types';

export type StyleId = 'funny';

export type StyleDef = {
  id: StyleId;
  /** How the chat shows and types it: '@funny'. */
  label: string;
  /** One line for the mention list and /style. */
  description: string;
  /** Who the model is while the style is on (2–4 sentences). chat.rs reads the same line from the brief. */
  persona: string;
  /** The Edit DNA the result must land inside. */
  band: DnaBand;
  /** The council seat that holds the cut to this style. */
  councilSeat: CouncilRole;
};

export const STYLES: readonly StyleDef[] = [
  {
    id: 'funny',
    label: '@funny',
    description: 'Roast / meme edit — memes on the punchline, receipts, keyed host, SFX on every entry',
    persona:
      'You are Bhippi AI in roast-editor mode: the editor behind fast roast and meme channels, cutting comedy to the syllable, for the audience the video is made for (their own country\'s memes, found on the internet for this video\'s jokes, plus global ones). ' +
      'Every meme lands on the end of the punchline word and echoes what the host just said, every claim gets its receipt, and every entry gets a sound. ' +
      'You never place a meme you cannot explain from a source, and you never let the host sit on raw green or talk for 8 seconds with nothing happening.',
    band: FUNNY_BAND,
    councilSeat: 'comedian',
  },
];

/** A style by id, with or without its `@` and in any case; undefined for anything else. */
export function findStyle(id: string | null | undefined): StyleDef | undefined {
  const wanted = (id ?? '').trim().replace(/^@/, '').toLowerCase();
  return wanted ? STYLES.find((style) => style.id === wanted) : undefined;
}

export const isStyleId = (value: unknown): value is StyleId => typeof value === 'string' && STYLES.some((style) => style.id === value);

/** The styles whose id starts with what follows the `@` being typed (all of them for a bare `@`). */
export function stylesMatching(prefix: string): StyleDef[] {
  const wanted = prefix.trim().replace(/^@/, '').toLowerCase();
  return STYLES.filter((style) => style.id.startsWith(wanted));
}

/**
 * The style a message tags, when it contains a whole `@id` token ("@funny roast this", "make it
 * @funny."). `@funnyman` or an e-mail address tags nothing; with several tags the first wins.
 */
export function styleInMessage(text: string): StyleDef | undefined {
  for (const match of text.matchAll(/(^|[\s([{"'“])@([a-z][\w-]*)/gi)) {
    const style = findStyle(match[2]);
    if (style) return style;
  }
  return undefined;
}
