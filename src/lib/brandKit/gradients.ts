import type { BrandGradient } from './types';

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
