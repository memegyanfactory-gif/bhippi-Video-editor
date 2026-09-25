// Logos inside exportable graphics.
//
// The frame renderer (src/lib/htmlFrames.ts) serialises a graphic into a data:image/svg+xml and
// decodes it as an image — a sandboxed document that cannot fetch anything. An <img> pointing at a
// file renders blank in the export while looking fine in the preview. Inline SVG survives as
// markup; raster logos have to travel as data URLs. This module turns an imported asset's path into
// one, once, and caches it (mirroring src/lib/peaks.ts).

import { fileSrc } from '../ipc';

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

/** A `data:` URL for a local image Bhippi imported; cached per path. */
export function assetDataUrl(path: string): Promise<string> {
  const hit = cache.get(path);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(path);
  if (pending) return pending;
  const task = (async () => {
    const response = await fetch(fileSrc(path));
    if (!response.ok) throw new Error(`could not read ${path}`);
    const blob = await response.blob();
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`could not encode ${path}`));
      reader.readAsDataURL(blob);
    });
    cache.set(path, url);
    inflight.delete(path);
    return url;
  })();
  inflight.set(path, task);
  return task;
}

/** The text of a local file Bhippi imported (SVG logos are inlined as markup). */
export async function assetText(path: string): Promise<string> {
  const response = await fetch(fileSrc(path));
  if (!response.ok) throw new Error(`could not read ${path}`);
  return response.text();
}

/** For tests and for kits imported with their cache already filled. */
export const rememberDataUrl = (path: string, url: string) => { cache.set(path, url); };

export const isDataUrl = (value: string | null | undefined): value is string => typeof value === 'string' && value.startsWith('data:image/');
