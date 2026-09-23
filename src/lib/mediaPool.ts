// Media elements live longer than the clips that use them.
//
// A razor cut is one file continuing to play: the clip ends, the next begins on the same frame of
// the same source. Mounting a fresh <video> for the second clip means loading, seeking and
// re-buffering — a visible freeze at every edit point, which is what made playback stutter on a
// timeline the AI had cut into dozens of pieces. So elements are borrowed from a pool instead:
// the running element is handed straight to the next clip and never stops.

type Kind = 'video' | 'audio';

const idle = new Map<string, HTMLMediaElement[]>();
/** Per source: enough for a transition (two sides) plus one in reserve. */
const LIMIT = 3;

const slot = (kind: Kind, src: string) => `${kind}:${src}`;

export const acquireMedia = (kind: Kind, src: string): HTMLMediaElement => {
  const pooled = idle.get(slot(kind, src))?.pop();
  if (pooled) return pooled;
  const element = document.createElement(kind);
  element.className = 'layer-media';
  element.preload = 'auto';
  element.crossOrigin = 'anonymous';
  if (kind === 'video') {
    const video = element as HTMLVideoElement;
    // The program's sound comes from the audio graph, never from the picture elements.
    video.muted = true;
    video.playsInline = true;
  }
  element.src = src;
  return element;
};

export const releaseMedia = (kind: Kind, src: string, element: HTMLMediaElement) => {
  element.remove();
  const id = slot(kind, src);
  const bucket = idle.get(id) ?? [];
  // A full bucket gives up its oldest element, never the one arriving: that one is still playing
  // at exactly the frame a plain cut's next clip needs, and it is the one acquireMedia hands out
  // next. Dropping it would leave that clip a stale idle element to seek and start from cold.
  if (bucket.length >= LIMIT) {
    const oldest = bucket.shift();
    if (oldest) {
      oldest.pause();
      oldest.removeAttribute('src');
      oldest.load();
    }
  }
  bucket.push(element);
  idle.set(id, bucket);
  // Stop it only if nothing picked it up: at a plain cut the next clip takes this very element, and
  // pausing it there is exactly the hiccup this pool exists to avoid. That hand-over happens inside
  // the same React commit (the old layer's cleanup and the new one's layout effect run in one
  // synchronous pass), so the check can run as soon as that pass ends. It used to wait 300 ms,
  // and a detached audio element keeps playing into the mix: at every jump cut the old line went
  // on sounding under the new one for 300 ms.
  queueMicrotask(() => {
    if (!element.isConnected && !element.paused) element.pause();
  });
};

/** Drops every idle element. Used when a project closes, so decoders are not held forever. */
export const clearMediaPool = () => {
  for (const bucket of idle.values()) {
    for (const element of bucket) {
      element.pause();
      element.removeAttribute('src');
      element.load();
    }
  }
  idle.clear();
};
