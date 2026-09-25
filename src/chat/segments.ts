// How an answer's words are kept while they stream, so they can be shown between the work that
// happened around them.
//
// A CLI provider (Codex, Claude Code) runs its own tool loop inside one completion: it says a
// sentence, calls a few tools, says the next sentence — and the words arrive as one unbroken
// stream. Appended blindly, "…for the edit." and "The transcript is about…" ran together with no
// space, and every sentence sat below one wall of activity. Here, a chunk that arrives after work
// has started since the last one opens a new segment and a new paragraph.
import type { Step, TextSegment, ToolRun } from './Activity';

type Words = { content: string; segments?: TextSegment[]; steps: Step[]; steers?: { at: number; state: string }[] };

/** The newlines needed between `before` and `after` for them to read as separate paragraphs. */
export function paragraphBreak(before: string, after: string): string {
  if (!before.trim() || !after.trim()) return '';
  const trailing = /\n*[ \t]*$/.exec(before)?.[0].split('\n').length ?? 1;
  const leading = /^[ \t]*\n*/.exec(after)?.[0].split('\n').length ?? 1;
  const have = trailing - 1 + (leading - 1);
  return have >= 2 ? '' : '\n'.repeat(2 - have);
}

/** Adds one streamed chunk of words, starting a new segment when work happened since the last. */
export function appendText(message: Words, piece: string, runs: ToolRun[], now: number): { content: string; segments: TextSegment[] } {
  const segments = message.segments ?? (message.content ? [{ at: 0, end: 0, text: message.content }] : []);
  const last = segments[segments.length - 1];
  // A message from the user that reached the turn splits the words too: what follows answers it.
  const workSince = !!last && (runs.some((run) => run.at > last.end) || message.steps.some((step) => step.at > last.end)
    || (message.steers ?? []).some((item) => item.state === 'delivered' && item.at > last.end));
  if (last && !workSince) {
    return { content: message.content + piece, segments: [...segments.slice(0, -1), { ...last, end: now, text: last.text + piece }] };
  }
  const gap = paragraphBreak(message.content, piece);
  return { content: message.content + gap + piece, segments: [...segments, { at: now, end: now, text: piece }] };
}

const squash = (text: string) => text.replace(/\s+/g, '');

/**
 * Settles the words once the turn is over. The backend's final reply is the authority: when it
 * says the same thing the stream did (whitespace aside) the segments stay, with the paragraph
 * breaks they gained; when it differs, the reply wins and the answer shows as one block.
 */
export function settleText(message: { content: string; segments?: TextSegment[] }, reply: string): { content: string; segments?: TextSegment[] } {
  if (!reply) return { content: message.content, segments: message.segments };
  if (message.segments?.length && squash(reply) === squash(message.content)) return { content: message.content, segments: message.segments };
  return { content: reply, segments: undefined };
}
