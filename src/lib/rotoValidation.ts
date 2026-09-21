import type { RotoResult } from './roto';
export function validateRotoResult(result: RotoResult): void {
  if (!result.matte || !Number.isInteger(result.frames) || result.frames < 1 || result.subjects?.length !== result.frames) throw new Error('Roto returned an incomplete matte. No layer was changed.');
  const covers = result.subjects.map(s => s.cover);
  if (covers.some(c => !Number.isFinite(c) || c < 0 || c > 1)) throw new Error('Roto returned invalid alpha coverage.');
  if (covers.every(c => c < 0.0001)) throw new Error('Roto did not find the selected subject. Add a foreground point inside the character on the first frame and retry.');
  if (covers.every(c => c > 0.9999)) throw new Error('Roto kept the entire frame. Add background exclusion points and retry; no usable cutout was produced.');
}
