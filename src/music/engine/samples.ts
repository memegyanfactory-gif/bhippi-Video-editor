// Decodes bin audio for the sampler and audio clips. `assetSampleLoader` turns the app's asset lookup into a
// SampleLoader: the file is read through the webview's file URL and decoded on a shared OfflineAudioContext
// (decoding is context-independent, and this keeps it off the live audio thread's context). Results are
// kept by asset id; a failed decode is not kept, so it can be retried.
import type { SampleLoader } from './api';

/**
 * @param pathOf   an asset id → its file path (null when unknown)
 * @param toUrl    a file path → a URL the webview can read (e.g. Tauri's convertFileSrc)
 */
export function assetSampleLoader(pathOf: (assetId: string) => string | null, toUrl: (path: string) => string): SampleLoader {
  const jobs: Record<string, Promise<AudioBuffer | null> | undefined> = {};
  let decoder: OfflineAudioContext | null = null;
  return (assetId) => {
    const known = jobs[assetId];
    if (known) return known;
    const job = (async (): Promise<AudioBuffer | null> => {
      const path = pathOf(assetId);
      if (!path) return null;
      try {
        const response = await globalThis.fetch(toUrl(path));
        if (!response.ok) return null;
        decoder ??= new OfflineAudioContext(2, 1, 44100);
        return await decoder.decodeAudioData(await response.arrayBuffer());
      } catch {
        return null;
      }
    })();
    jobs[assetId] = job;
    void job.then((buffer) => {
      if (!buffer) jobs[assetId] = undefined;
    });
    return job;
  };
}
