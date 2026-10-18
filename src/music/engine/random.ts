// Seeded randomness for the engine. Every noise buffer, impulse response, probability roll and voice
// phase comes from here, so the same song bounces to the same samples every time.

/** A small, fast, good-quality PRNG: returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the characters of a string. */
export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** One well-mixed 32-bit seed from several numbers / strings (song seed, note id, step…). */
export function mixSeed(...parts: Array<number | string>): number {
  let h = 2166136261;
  for (const part of parts) {
    const v = typeof part === 'string' ? hashString(part) : Math.floor(part) | 0;
    h = Math.imul(h ^ v, 16777619);
    h ^= h >>> 15;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
