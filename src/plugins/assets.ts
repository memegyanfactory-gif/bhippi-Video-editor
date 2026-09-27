// Plugin assets: the pictures, models, fonts, sounds, clips and WebAssembly a plugin carries in its
// draft next to its code. A draft is a map of names to strings, so a binary file is held as base64
// in memory and over IPC; on disk (plugins.rs) and in a package zip it is its real bytes, and its
// hash in the lock is the hash of those bytes.
//
// plugin_save bundles every asset into the page as a script block that never runs
// (<script type="application/octet-stream" data-bhippi-asset="name">base64</script>), so the page
// stays one checked document: `bhippi.asset(name)` in the SDK turns a block into a blob URL.

/** Binary file types a draft may hold, with the type the SDK gives their blob. */
export const BINARY_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  glb: 'model/gltf-binary', bin: 'application/octet-stream',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm',
  wasm: 'application/wasm',
};

/** Text file types a draft may hold. html/js/css are code; the rest are data the page can read. */
export const TEXT_TYPES: Record<string, string> = {
  html: 'text/html', js: 'text/javascript', css: 'text/css', md: 'text/markdown',
  json: 'application/json', svg: 'image/svg+xml', txt: 'text/plain', gltf: 'model/gltf+json',
};

/** Every file type a draft may hold. */
export const DRAFT_TYPES = [...Object.keys(TEXT_TYPES), ...Object.keys(BINARY_TYPES)];

const extension = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');

export const isBinaryFile = (name: string) => extension(name) in BINARY_TYPES;
export const mimeOf = (name: string) => BINARY_TYPES[extension(name)] ?? TEXT_TYPES[extension(name)] ?? 'application/octet-stream';

/** Draft files that are the plugin's own furniture, never assets. */
const NOT_ASSETS = new Set(['manifest.json', 'manifest.lock.json', 'logo.svg', 'spec.md', 'index.html']);

/** Whether a draft file is bundled into the page as an asset: binary files, and svg/json/txt/gltf data. */
export function isAssetFile(name: string): boolean {
  if (NOT_ASSETS.has(name)) return false;
  return isBinaryFile(name) || ['svg', 'json', 'txt', 'gltf'].includes(extension(name));
}

// ---------------------------------------------------------------------------------------------
// Base64

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
export const isBase64 = (text: string) => text.length % 4 === 0 && B64.test(text);

export function bytesToBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The real bytes of a draft file: decoded base64 for a binary file, UTF-8 for text. */
export const fileBytes = (name: string, text: string): Uint8Array => (isBinaryFile(name) ? base64ToBytes(text) : new TextEncoder().encode(text));

/** A draft file's size on disk. */
export const fileSize = (name: string, text: string) => (isBinaryFile(name) ? Math.floor((text.length * 3) / 4) - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0) : new TextEncoder().encode(text).length);

// ---------------------------------------------------------------------------------------------
// Bundling

const escapeAttr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The draft's assets as inert script blocks, for the end of the bundled page. */
export function assetBlocks(files: Record<string, string>): string {
  return Object.keys(files)
    .filter(isAssetFile)
    .sort()
    .map((name) => {
      const data = isBinaryFile(name) ? files[name] : bytesToBase64(new TextEncoder().encode(files[name]));
      return `<script type="application/octet-stream" data-bhippi-asset="${escapeAttr(name)}" data-mime="${escapeAttr(mimeOf(name))}">${data}</script>`;
    })
    .join('\n');
}
