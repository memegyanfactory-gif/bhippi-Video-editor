// Makes public/template-thumbs: a 320×180 picture of every template, as its filled example looks
// at its hold frame (src/lib/templateExamples.ts). House (Crimson) templates are HTML, so each is a
// headless-Chrome screenshot of template-lab.html?thumb=<id>; motion-kit templates are drawn by the
// GPU engine in motion-lab.html?thumbs (templates that need the user's footage are skipped).
//
//   npm run dev -- --port 5199      (in another terminal)
//   node scripts/make-template-thumbs.mjs --url http://localhost:5199 [--chrome <path>]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const url = arg('url', 'http://localhost:5173');
const chrome = arg('chrome', [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((path) => existsSync(path)));
if (!chrome) throw new Error('No Chrome or Edge found: pass --chrome <path>.');

const out = 'public/template-thumbs';
mkdirSync(out, { recursive: true });
const run = (args) => execFileSync(chrome, ['--headless=new', '--hide-scrollbars', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

// House templates: the ids of CRIMSON_EXAMPLES.
const examples = readFileSync('src/lib/templateExamples.ts', 'utf8');
const block = examples.slice(examples.indexOf('export const CRIMSON_EXAMPLES'), examples.indexOf('export const BRAND_EXAMPLES'));
const house = [...block.matchAll(/^\s+'?([a-z0-9-]+)'?: \{/gm)].map((m) => m[1]);
for (const id of house) {
  const file = join(out, `${id}.png`);
  run(['--disable-gpu', '--virtual-time-budget=20000', '--window-size=320,180', `--screenshot=${join(process.cwd(), file)}`, `${url}/template-lab.html?thumb=${id}`]);
  console.log('house', id);
}

// Motion-kit templates: JPEG data URLs from the lab.
const dom = run(['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--virtual-time-budget=250000', '--window-size=1920,1080', '--dump-dom', `${url}/motion-lab.html?thumbs=1`]);
const pre = /<pre id="thumbs">([\s\S]*?)<\/pre>/.exec(dom);
if (!pre) throw new Error('motion-lab.html?thumbs gave no thumbnails (is the dev server running?)');
const decoded = pre[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const { thumbs, skipped } = JSON.parse(decoded);
for (const [id, dataUrl] of Object.entries(thumbs)) writeFileSync(join(out, `${id}.jpg`), Buffer.from(dataUrl.split(',')[1], 'base64'));
writeFileSync(join(out, 'index.json'), `${JSON.stringify({ house: house.map((id) => `${id}.png`), kit: Object.keys(thumbs).map((id) => `${id}.jpg`) }, null, 1)}\n`);
console.log(`${house.length} house + ${Object.keys(thumbs).length} kit thumbnails in ${out}; skipped: ${skipped.join(', ') || 'none'}`);
