import { api } from './ipc';
import type { RotoResult } from './roto';

export async function depthOcclusion(assetId: string, from: number, seconds: number, fps: number, threshold: number, softness: number, signal?: AbortSignal): Promise<RotoResult> {
  const check = () => { if (signal?.aborted) throw new Error('Cancelled'); };
  check();
  if (seconds <= 0 || seconds > 300 || fps > 60) throw new Error('Depth supports shots up to 300 seconds at up to 60 fps. Split longer shots first.');
  const pulled = await api.rotoFrames(assetId, from, seconds, fps);
  check();
  const actualFps = pulled.fps ?? fps;
  const jobId = await api.depthStart(pulled.runId, from, actualFps, threshold, softness);
  for (;;) {
    if (signal?.aborted) { await api.jobCancel(jobId); check(); }
    const job = (await api.jobsList()).find(item => item.id === jobId);
    if (!job) throw new Error('Depth job disappeared.');
    if (job.status === 'error' || job.status === 'cancelled') throw new Error(job.message);
    if (job.status === 'done') {
      check();
      const result = (job.result as { roto?: RotoResult } | null)?.roto;
      if (!result?.matte) throw new Error('Depth inference returned no occlusion matte.');
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
