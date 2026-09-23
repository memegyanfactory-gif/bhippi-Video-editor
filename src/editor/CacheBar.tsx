// The render bar under the Timeline's ruler, After Effects-style: green where the Program monitor
// has everything in RAM (motion scenes rendered, media warmed), yellow where the preview cache
// (lib/previewCache.ts) is still working, nothing where nothing needs caching.
import { usePreviewCache } from '../lib/previewCache';

export function CacheBar({ compId, zoom, head }: { compId: string; zoom: number; head: number }) {
  const cache = usePreviewCache();
  if (!cache.enabled || cache.compId !== compId || !cache.spans.length) return null;
  const mb = Math.round(cache.bytes / 1048576);
  const title = `Cached in RAM · ${mb} MB of ${Math.round(cache.budget / 1048576)} MB · ${cache.frames} motion frames`;
  return (
    <div className="ruler-cache" aria-hidden="true">
      {cache.spans.map((span) => (
        <div key={`${span.start}-${span.state}`} className={`ruler-cache-span ${span.state}`} title={span.state === 'ready' ? title : `Caching… · ${title}`}
          style={{ left: head + span.start * zoom, width: Math.max(1, (span.end - span.start) * zoom) }} />
      ))}
    </div>
  );
}
