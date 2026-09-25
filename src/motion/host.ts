// The Bhippi editor as a MediaHost: project assets by id (proxy in the preview, the original for
// export) and roto mattes as the numbered PNGs the Roto tool writes beside `matte.mkv`.
import { api, fileSrc } from '../lib/ipc';
import type { Asset } from '../lib/types';
import type { MediaHost, MatteSequence } from './sources';

const sep = (path: string) => (path.includes('\\') ? '\\' : '/');

const matteCache = new Map<string, Promise<MatteSequence | null>>();

/** The matte frame sequence of a roto run, read once. */
export function rotoMatteSequence(mattePath: string): Promise<MatteSequence | null> {
  let hit = matteCache.get(mattePath);
  if (!hit) {
    const parts = mattePath.replaceAll('\\', '/').split('/');
    const runId = parts.at(-2) ?? '';
    const s = sep(mattePath);
    const folder = mattePath.slice(0, mattePath.lastIndexOf(s));
    hit = api.rotoRead(runId).then((meta) => {
      if (!meta || !meta.frames) return null;
      return {
        fps: meta.fps,
        frames: meta.frames,
        first: meta.subjects[0]?.at ?? 0,
        frameUrl: (index: number) => fileSrc(`${folder}${s}preview${s}${String(index + 1).padStart(5, '0')}.png`),
      };
    }).catch(() => null);
    matteCache.set(mattePath, hit);
  }
  return hit;
}

export function editorMediaHost(assets: Map<string, Asset> | Asset[], purpose: 'preview' | 'export'): MediaHost {
  const byId = assets instanceof Map ? assets : new Map(assets.map((asset) => [asset.id, asset]));
  return {
    resolve(source) {
      if (source.asset) {
        const asset = byId.get(source.asset);
        if (!asset || asset.missing) return null;
        // The webview decodes only some codecs; everything else previews (and exports) from its proxy.
        const playable = asset.kind === 'image' || asset.preview === 'native';
        const path = purpose === 'export' && playable ? asset.path : asset.proxy ?? asset.path;
        return { url: fileSrc(path), kind: asset.kind === 'image' ? 'image' : 'video', width: asset.width, height: asset.height };
      }
      if (source.path) return { url: /^(https?|asset|data|blob):/.test(source.path) ? source.path : fileSrc(source.path), kind: source.kind ?? (/\.(png|jpe?g|webp|gif|bmp)$/i.test(source.path) ? 'image' : 'video') };
      return null;
    },
    matte: rotoMatteSequence,
    file: (path) => (/^(https?|asset|data|blob):/.test(path) ? path : fileSrc(path)),
  };
}
