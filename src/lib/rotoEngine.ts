import type { RotoCorrection } from './types';
export function automaticRotoEngine(selected: string | null | undefined, points: RotoCorrection[], fps: number): 'rvm' | 'sam2-vitmatte' {
  const seeded = points.some(p => p.mode === 'include' && Number.isFinite(p.at) && p.at >= 0 && Math.floor(p.at * fps) === 0);
  return selected === 'sam2-vitmatte' && seeded ? 'sam2-vitmatte' : 'rvm';
}
