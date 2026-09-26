// What one provider passes to the next when a conversation changes hands.
//
// A chat is not tied to the model that started it. The picker can move to another provider at any
// point, including part-way through a job, and the user's expectation is continuity: the new model
// should pick up the work rather than meet the project for the first time. Everything needed for
// that is already in the transcript, so it is read from there rather than tracked alongside —
// which is also what makes a cleared chat start clean without anything having to remember to
// forget.

/** The builtin offline parser. Its turns are Bhippi talking to itself, not a provider answering. */
export const BUILTIN = 'bhippi';

/** How many turns of the conversation travel with a request; the backend trims to its own limit. */
export const HISTORY_TURNS = 12;

/** The shape this module needs from a transcript entry; `ChatMessage` satisfies it. */
export type Turn =
  | { role: 'user'; content: string; images?: string[]; annotationBrief?: string }
  | {
      role: 'assistant';
      content: string;
      status: string;
      providerId: string;
      providerLabel: string;
      model: string | null;
    };

export type HistoryLine = { role: 'user' | 'assistant'; content: string; speaker: string | null; images?:string[] };

export type Handoff = { fromLabel: string; fromModel: string | null };

/** Whether an assistant turn left words worth carrying forward. */
const spoke = (turn: Turn): boolean =>
  turn.role === 'assistant' && turn.providerId !== BUILTIN && turn.content.trim() !== '';

/**
 * The provider whose answer the next turn is continuing from, or null when there is none.
 *
 * Null after `/clear` and in a new conversation, which is the whole of "a new chat starts new":
 * no transcript, nobody to take over from, no handover note.
 */
export function lastSpeaker(messages: Turn[]): Extract<Turn, { role: 'assistant' }> | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const turn = messages[i];
    if (turn.role === 'assistant' && spoke(turn)) return turn;
  }
  return null;
}

/**
 * The handover for a turn about to go to `providerId`/`model`, or null when there is nothing to
 * hand over.
 *
 * A different model counts as much as a different provider: the same vendor's small and large
 * models are not the same mind, and the one arriving still needs telling that the words above are
 * not its own.
 */
export function handoffFor(messages: Turn[], providerId: string | null, model: string | null): Handoff | null {
  const previous = lastSpeaker(messages);
  if (!previous) return null;
  if (previous.providerId === providerId && previous.model === model) return null;
  return { fromLabel: previous.providerLabel, fromModel: previous.model };
}

/**
 * The conversation as the next request should carry it.
 *
 * A turn the user cut short is kept when it managed to say something: those words are what the
 * next model has to carry on from, and dropping them is how a handover loses the half-finished
 * job it is inheriting. A turn that only faulted is dropped — it has nothing to contribute but
 * an error the user has already seen.
 *
 * `speaker` is filled in only when someone other than the model being asked said the line, so a
 * model is never shown its own words under another name, nor another model's words as its own.
 */
/** Providers whose models are sent images (attachments, annotation snapshots). */
export const seesImages = (providerId: string | null) => ['claude','codex','opencode','anthropic','openai','google','openrouter','opencode-zen'].includes(providerId || '');

export function historyFor(messages: Turn[], providerId: string | null, model: string | null): HistoryLine[] {
  const history:HistoryLine[] = messages
    .filter((turn) =>
      turn.role === 'user'
        ? turn.content.trim() !== ''
        : (turn.status === 'done' || turn.status === 'stopped') && turn.content.trim() !== '',
    )
    .map((turn) => ({
      role: turn.role,
      // Monitor annotations sent with a message stay in what later turns read, or "the title I
      // marked" would mean nothing one message on.
      content: turn.role === 'user' && turn.annotationBrief ? `${turn.content}\n\n${turn.annotationBrief}` : turn.content,
      ...(turn.role === 'user' && turn.images?.length ? { images: turn.images } : {}),
      speaker:
        turn.role === 'assistant' && (turn.providerId !== providerId || turn.model !== model)
          ? turn.providerLabel
          : null,
    }))
    .slice(-HISTORY_TURNS);
  // Keep the transcript intact while bounding what is resent. Reserve space for four new images.
  let budget=8*1024*1024,count=12;
  const vision=seesImages(providerId);
  return history.reverse().map(line=>{
    if(!line.images?.length)return line;
    const kept=line.images.filter(image=>{if(!vision||count<=0||image.length>budget)return false;budget-=image.length;count--;return true;});
    return {...line,images:kept,content:line.content+(kept.length<line.images.length?'\n[Some earlier image attachments are omitted from this request; ask for them again if needed.]':'')};
  }).reverse();
}
