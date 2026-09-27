// Builds the libraries the Plugin Maker may copy into a plugin (src/plugins/libraries.ts):
// each one a single self-contained script that sets one global, so it runs under a plugin's
// strict page policy (its own inline code only). Output goes to public/plugin-libs/; the SHA-256
// of every file is printed for the registry, which pins it.
//
//   node scripts/build-plugin-libs.mjs

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'plugin-libs');
mkdirSync(out, { recursive: true });

const LIBS = [
  {
    file: 'three.min.js',
    global: 'THREE',
    // three itself and the add-ons a 3D panel needs most: orbiting the view, moving objects, loading glTF.
    source: `
      export * from 'three';
      export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
      export { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
      export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
      export { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
      export { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
    `,
  },
];

for (const lib of LIBS) {
  const version = JSON.parse(readFileSync(join(root, 'node_modules', 'three', 'package.json'), 'utf8')).version;
  const result = await build({
    stdin: { contents: lib.source, resolveDir: root, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: lib.global,
    target: 'es2020',
    legalComments: 'none',
    write: false,
    banner: { js: `/* ${lib.file}: three.js r${version.split('.')[1]} (MIT, https://threejs.org/) bundled for Bhippi plugins as window.${lib.global} */` },
  });
  const code = result.outputFiles[0].text;
  writeFileSync(join(out, lib.file), code);
  const sha = createHash('sha256').update(code).digest('hex');
  console.log(`${lib.file}  ${version}  ${(code.length / 1024).toFixed(0)} KB  sha256 ${sha}`);
}
