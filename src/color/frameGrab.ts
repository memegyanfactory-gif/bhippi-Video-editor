// Reading the picture the Program monitor is showing, small: for the scopes and Auto Balance.
// The pooled video elements and graded stills load with CORS (lib/mediaPool.ts), so their pixels
// can be read; the grade itself is applied afterwards in lib/colorScopes.ts.

let scratch: HTMLCanvasElement | null = null;

/** The media element of a clip in the Program monitor (a video, or a still). */
export function clipMedia(clipId: string, root: ParentNode = document): HTMLVideoElement | HTMLImageElement | null {
  const layer = root.querySelector(`.monitor.program [data-clip-id="${CSS.escape(clipId)}"]`) ?? root.querySelector(`[data-clip-id="${CSS.escape(clipId)}"]`);
  if (!layer) return null;
  return layer.querySelector('video') ?? layer.querySelector('img.layer-media');
}

/** A media element drawn at most `maxWidth` wide; null when it has no frame yet or cannot be read. */
export function grabMedia(media: HTMLVideoElement | HTMLImageElement, maxWidth = 320): ImageData | 'blocked' | null {
  const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
  const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
  if (!width || !height || (media instanceof HTMLVideoElement && media.readyState < 2)) return null;
  const w = Math.max(1, Math.min(maxWidth, width)), h = Math.max(1, Math.round((w / width) * height));
  scratch ??= document.createElement('canvas');
  if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(media, 0, 0, w, h);
    return context.getImageData(0, 0, w, h);
  } catch {
    return 'blocked';
  }
}

/** A clip's current frame in the Program monitor, ungraded; null when it is not on screen. */
export function grabClip(clipId: string, maxWidth = 320): ImageData | null {
  const media = clipMedia(clipId);
  if (!media) return null;
  const image = grabMedia(media, maxWidth);
  return image === 'blocked' ? null : image;
}
