import type { SubjectBox } from './ipc';

export type RotoBenchmarkReport = {
  frames: number;
  coverage: number;
  emptyFrames: number;
  boxJitter: number;
  edgeCases: { hair: 'unmeasured'; blur: 'unmeasured'; holes: 'unmeasured'; fineObjects: 'unmeasured'; spill: 'unmeasured'; flicker: 'proxy' };
  baseline: 'RVM';
  candidates: { id: string; status: 'check-settings' | 'license-review' | 'runtime-review' }[];
  notes: string[];
};

/** A reproducible, model-agnostic report from the cached pass. It deliberately does not call a
 * segmentation model or claim that boxes are alpha quality; pixel-level edge cases need reviewed
 * reference mattes. */
export function benchmarkRoto(subjects: SubjectBox[]): RotoBenchmarkReport {
  const ordered = [...subjects].sort((a, b) => a.at - b.at);
  const emptyFrames = ordered.filter((frame) => frame.cover <= 0 || frame.width <= 0 || frame.height <= 0).length;
  const valid = ordered.filter((frame) => frame.cover > 0 && frame.width > 0 && frame.height > 0);
  const coverage = valid.length ? valid.reduce((sum, frame) => sum + frame.cover, 0) / valid.length : 0;
  let jitter = 0;
  for (let i = 1; i < valid.length; i++) {
    const a = valid[i - 1];
    const b = valid[i];
    jitter += Math.hypot(a.x - b.x, a.y - b.y) + Math.hypot(a.width - b.width, a.height - b.height);
  }
  return {
    frames: ordered.length,
    coverage,
    emptyFrames,
    boxJitter: valid.length > 1 ? jitter / (valid.length - 1) : 0,
    edgeCases: { hair: 'unmeasured', blur: 'unmeasured', holes: 'unmeasured', fineObjects: 'unmeasured', spill: 'unmeasured', flicker: 'proxy' },
    baseline: 'RVM',
    candidates: [
      { id: 'sam2.1-trimap-vitmatte', status: 'check-settings' },
      { id: 'sam3.1', status: 'license-review' },
      { id: 'matanyone2', status: 'license-review' },
      { id: 'videomama', status: 'license-review' },
      { id: 'corridorkey', status: 'runtime-review' },
    ],
    notes: ['Segmentation coverage and box jitter are screening metrics, not alpha-matte quality.', 'Review hair, blur, holes, fine objects, spill and frame flicker against a reference matte before replacing RVM.'],
  };
}
