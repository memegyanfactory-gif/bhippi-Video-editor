import type { BrandGradient, BrandKit } from './types';

/** Older/AI-written kits can contain text gradients. Preserve their colours and angle. */
export function normalizeGradients(value: unknown): BrandGradient[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row, index) => {
    if (typeof row === 'string') {
      const stops = row.match(/#[0-9a-f]{6}\b/gi) ?? [];
      const angle = Number(row.match(/(-?\d+(?:\.\d+)?)deg/i)?.[1] ?? 135);
      return stops.length >= 2 ? [{ name: `Gradient ${index + 1}`, angle, stops, usage: '' }] : [];
    }
    if (!row || typeof row !== 'object' || !Array.isArray(row.stops)) return [];
    const stops = row.stops.filter((stop: unknown): stop is string => typeof stop === 'string' && /^#[0-9a-f]{6}$/i.test(stop));
    return stops.length >= 2 ? [{ name: typeof row.name === 'string' ? row.name : `Gradient ${index + 1}`, angle: Number.isFinite(row.angle) ? row.angle : 135, stops, usage: typeof row.usage === 'string' ? row.usage : '' }] : [];
  });
}

const repaired = new WeakMap<BrandKit, { source: unknown; kit: BrandKit }>();
export function normalizeKitGradients(kit: BrandKit): BrandKit {
  const source = kit.colors.gradients;
  if (Array.isArray(source) && source.every((row) => row && typeof row === 'object' && typeof row.name === 'string' && Number.isFinite(row.angle) && typeof row.usage === 'string' && Array.isArray(row.stops) && row.stops.length >= 2 && row.stops.every((stop) => typeof stop === 'string' && /^#[0-9a-f]{6}$/i.test(stop)))) return kit;
  const cached = repaired.get(kit);
  if (cached && cached.source === source) return cached.kit;
  const normalized = { ...kit, colors: { ...kit.colors, gradients: normalizeGradients(source) } };
  repaired.set(kit, { source, kit: normalized });
  return normalized;
}
