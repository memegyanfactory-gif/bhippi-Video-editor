// What the user asked in each chat turn, so a tool can tell whether a request came from the user.
// Used by the colour tools: Bhippi AI may only add, change or remove a LUT when the user's own
// message for that turn asks for one.

const prompts = new Map<string, string>();

export function rememberTurnPrompt(turnId: string, message: string) {
  prompts.set(turnId, message);
  while (prompts.size > 64) prompts.delete(prompts.keys().next().value!);
}

/** The user's message that started a turn; empty when unknown (which fails closed). */
export function turnPrompt(turnId: string | undefined): string {
  return turnId ? prompts.get(turnId) ?? '' : '';
}

/** Whether a message asks for a LUT: "LUT", "LUTs", a ".cube" file, or "look-up table". */
export function asksForLut(message: string): boolean {
  return /\bluts?\b|\.cube\b|look[\s-]?up[\s-]?tables?/i.test(message);
}
