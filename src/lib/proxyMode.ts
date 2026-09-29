// Whether the preview reads proxies (Program monitor's Proxies toggle). A file the webview cannot
// play (HEVC, ProRes, HDR…) always previews from its proxy; a file that plays natively uses its
// proxy (Project panel › Create Proxy) only while this is on. Exports always read the originals.
import { useSyncExternalStore } from 'react';
import type { Asset } from './types';

const KEY = 'bhippi.useProxies';
const listeners = new Set<() => void>();
let on = (() => {
  try {
    return localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
})();

export const proxyMode = {
  get: () => on,
  set(value: boolean) {
    on = value;
    try {
      localStorage.setItem(KEY, String(value));
    } catch {
      // Not remembered this session; the toggle still works.
    }
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const useProxyMode = () => useSyncExternalStore(proxyMode.subscribe, proxyMode.get, proxyMode.get);

/** The file the preview plays for `asset`: its proxy when it needs one, or when proxies are on. */
export function previewPath(asset: Pick<Asset, 'path' | 'proxy' | 'preview'>, proxies = on): string {
  if (!asset.proxy) return asset.path;
  return asset.preview !== 'native' || proxies ? asset.proxy : asset.path;
}

/** Whether `asset` is being previewed from a proxy made for speed (not one it needs to play at all). */
export const onOptionalProxy = (asset: Pick<Asset, 'proxy' | 'preview'>, proxies = on) => !!asset.proxy && asset.preview === 'native' && proxies;
