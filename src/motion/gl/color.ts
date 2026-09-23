// CSS colour strings → premultiplication-free RGBA in 0..1 (hex, rgb(), rgba(), a few names).
const NAMED: Record<string, string> = { white: '#ffffff', black: '#000000', red: '#ff0000', transparent: '#00000000', crimson: '#dc143c' };

const cache = new Map<string, [number, number, number, number]>();

export function parseColor(input: string | null | undefined): [number, number, number, number] {
  const raw = (input ?? '#000000').trim().toLowerCase();
  const hit = cache.get(raw);
  if (hit) return hit;
  let out: [number, number, number, number] = [0, 0, 0, 1];
  const value = NAMED[raw] ?? raw;
  if (value.startsWith('#')) {
    let h = value.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const num = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    out = [num(0) || 0, num(2) || 0, num(4) || 0, h.length >= 8 ? num(6) : 1];
  } else {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(/[\s,/]+/).filter(Boolean).map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
      out = [(parts[0] ?? 0) / 255, (parts[1] ?? 0) / 255, (parts[2] ?? 0) / 255, parts[3] === undefined ? 1 : parts[3] > 1 ? parts[3] / 255 : parts[3]];
    }
  }
  if (cache.size > 2000) cache.clear();
  cache.set(raw, out);
  return out;
}
