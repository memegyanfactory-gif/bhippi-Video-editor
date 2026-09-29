// Messages the user sends while a turn is still working.
//
// Waiting for the turn to end before sending them (the old queue) meant a correction such as "use
// the second clip instead" arrived after the model had already done it the first way. Every
// provider's work goes through Bhippi's own tools, so the fastest way back into a running turn is
// the next tool result it reads: the note rides along with it, and the model folds it into its plan
// mid-stride — the way the Claude app takes a message typed while it works. A turn that makes no
// more tool calls never reads one, so whatever is still waiting when it ends is sent as the next
// message instead.

export type Steer = { id: string; text: string };

const inbox = new Map<string, Steer[]>();
const listeners = new Set<(turnId: string, ids: string[]) => void>();
/** Bhippi's own reminders for a running turn (not the user's words), by turn. */
const nudges = new Map<string, string[]>();

export const steer = {
  /** A reminder from Bhippi itself, read with the turn's next tool result like a steer. */
  nudge(turnId: string, text: string) {
    nudges.set(turnId, [...(nudges.get(turnId) ?? []), text]);
  },
  /** Waits for the next tool result of `turnId`. */
  push(turnId: string, item: Steer) {
    inbox.set(turnId, [...(inbox.get(turnId) ?? []), item]);
  },
  /** Removes one the user took back before it went. */
  drop(turnId: string, id: string) {
    const left = (inbox.get(turnId) ?? []).filter((item) => item.id !== id);
    if (left.length) inbox.set(turnId, left);
    else inbox.delete(turnId);
  },
  /** Everything still waiting for `turnId`, emptied: for a turn that ended before reading them. */
  take(turnId: string): Steer[] {
    const items = inbox.get(turnId) ?? [];
    inbox.delete(turnId);
    return items;
  },
  /**
   * Hands the waiting messages to a tool result on its way back to the model, and tells the chat
   * they went. Returns the result unchanged when nothing is waiting.
   */
  attach<T extends object>(turnId: string, result: T): T {
    const reminders = nudges.get(turnId) ?? [];
    nudges.delete(turnId);
    if (reminders.length) result = { ...result, bhippiNote: reminders.join('\n\n') };
    const items = steer.take(turnId);
    if (!items.length) return result;
    for (const listener of listeners) listener(turnId, items.map((item) => item.id));
    const said = items.map((item) => item.text).join('\n\n');
    return {
      ...result,
      userMessage: `The user sent this while you were working: "${said}". Take it into account from here on — adjust the rest of your current plan to it (do not start over or redo finished work unless it asks you to), acknowledge it in a short line, then carry on.`,
    };
  },
  /** Called with the ids that reached a running turn. */
  onDelivered(listener: (turnId: string, ids: string[]) => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};
