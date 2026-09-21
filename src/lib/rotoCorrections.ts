import type { RotoCorrection } from './types';

/** Corrections affect their recorded timeline frame only; propagation is a separate operation. */
export function correctedAlpha(alpha: number, x: number, y: number, width: number, height: number, at: number, fps: number, corrections: RotoCorrection[]): number {
  let result = alpha;
  for (const point of corrections) {
    if (Math.floor((at + 1e-7) * fps) !== Math.floor(point.at * fps)) continue;
    const radius = Math.max(1, Math.max(0.001, Math.min(1, point.radius)) * Math.min(width, height));
    const feather = Math.max(0.001, radius * Math.max(0, Math.min(1, point.softness)));
    const distance = Math.hypot(x + 0.5 - Math.max(0, Math.min(1, point.x)) * width, y + 0.5 - Math.max(0, Math.min(1, point.y)) * height);
    const strength = Math.max(0, Math.min(1, (radius - distance) / feather));
    result = point.mode === 'include' ? Math.max(result, strength) : Math.min(result, 1 - strength);
  }
  return result;
}
