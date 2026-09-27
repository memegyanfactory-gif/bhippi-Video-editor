// Libraries a plugin may carry: builds Bhippi ships in public/plugin-libs/ (made by
// scripts/build-plugin-libs.mjs), each one script that sets one global. Plugins cannot load code
// from a CDN, so plugin_add_library copies a library into the draft instead: the copy is checked
// against the SHA-256 pinned here, then hashed in the package lock like the plugin's own code.

export type PluginLibrary = {
  id: string;
  name: string;
  version: string;
  /** Its file in public/plugin-libs/, and the name it gets in a draft. */
  file: string;
  /** The global it sets. */
  global: string;
  sha256: string;
  license: string;
  about: string;
  /** How a plugin uses it, for the AI. */
  usage: string;
};

export const LIBRARIES: PluginLibrary[] = [
  {
    id: 'three',
    name: 'three.js',
    version: '0.186.1',
    file: 'three.min.js',
    global: 'THREE',
    sha256: 'a8df7f81ec5c1160b7d196e785a5d725265edb73d38ccc3f92cb4be528e8abb5',
    license: 'MIT',
    about: '3D in WebGL: scenes, meshes, materials, lights, cameras, animation, plus OrbitControls, TransformControls, GLTFLoader, GLTFExporter and RoomEnvironment (about 850 KB).',
    usage: 'Add <script src="three.min.js"></script> to index.html BEFORE app.js; then THREE.Scene, THREE.WebGLRenderer, new THREE.OrbitControls(camera, renderer.domElement), new THREE.GLTFLoader().parse(await bhippi.assetBytes("model.glb"), "", onLoad). Render into a canvas sized to the panel, and redraw on resize.',
  },
];

export const findLibrary = (id: string) => LIBRARIES.find((library) => library.id === id.trim().toLowerCase() || library.file === id.trim());

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A library's code, as Bhippi ships it; refused when it does not match its pinned hash. */
export async function loadLibrary(library: PluginLibrary, read: (file: string) => Promise<string> = defaultRead): Promise<string> {
  const code = await read(library.file);
  if ((await sha256(code)) !== library.sha256) throw new Error(`${library.file} does not match the copy Bhippi was built with, so it was not added.`);
  return code;
}

async function defaultRead(file: string): Promise<string> {
  const response = await fetch(`/plugin-libs/${file}`);
  if (!response.ok) throw new Error(`Bhippi could not read its copy of ${file} (${response.status}).`);
  return response.text();
}
