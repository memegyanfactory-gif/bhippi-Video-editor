// `@KitName` in a chat message tags a brand kit for that turn: the AI follows that kit (and what it
// has learned) even when the project uses another. The tag is the kit's name without spaces.
export const kitTag = (name: string) => name.replace(/\s+/g, '');

/** The kits tagged in `message`, in the order they appear (each once). */
export function kitsInMessage<T extends { id: string; name: string }>(message: string, kits: T[]): T[] {
  const byTag = new Map(kits.map((kit) => [kitTag(kit.name).toLowerCase(), kit]));
  const out: T[] = [];
  for (const match of message.matchAll(/(?:^|\s)@([\w-]+)/g)) {
    const kit = byTag.get(match[1].toLowerCase());
    if (kit && !out.includes(kit)) out.push(kit);
  }
  return out;
}

/** Kits whose tag starts with what is typed after `@`. */
export const kitsMatching = <T extends { name: string }>(query: string, kits: T[]) => kits.filter((kit) => kitTag(kit.name).toLowerCase().startsWith(query.toLowerCase()));
