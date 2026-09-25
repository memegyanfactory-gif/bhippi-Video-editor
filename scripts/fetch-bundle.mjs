// Fills src-tauri/bundled/ with what the installer ships beside Bhippi, so a fresh install works
// offline from the first launch: FFmpeg + FFprobe (export, previews, analysis), yt-dlp (online
// media and memes), the whisper.cpp and Piper engines (offline transcription and voices) and the
// Robust Video Matting models (Roto). Models big enough to matter — Whisper weights, voices, the
// GPU AI runtime — are one-click packs inside Bhippi instead, so installers and updates stay small.
// Text-to-image and text-to-video models are never bundled.
//
// Runs before `tauri build` (npm run bundle). Downloads are cached in work/bundle-cache and
// checked by size; the output folder is rebuilt from the cache. Windows only for now.
//
//   node scripts/fetch-bundle.mjs          fill src-tauri/bundled (skips what is already there)
//   node scripts/fetch-bundle.mjs --clean  empty it first
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src-tauri', 'bundled');
const CACHE = join(ROOT, 'work', 'bundle-cache');

/** Pinned sources. The FFmpeg "latest" asset of a release branch gets point fixes only. */
const SOURCES = {
  ffmpeg: { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-win64-gpl-shared-8.1.zip', file: 'ffmpeg-n8.1-win64-gpl-shared.zip' },
  ytdlp: { url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', file: 'yt-dlp.exe' },
  // The same archives Settings › Speech & voice downloads (src-tauri/src/models.rs), unpacked the same way.
  whisper: { url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip', file: 'whisper-bin-x64.zip' },
  piper: { url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip', file: 'piper_windows_amd64.zip' },
  rvm32: { url: 'https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx', file: 'rvm_mobilenetv3_fp32.onnx' },
  rvm16: { url: 'https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp16.onnx', file: 'rvm_mobilenetv3_fp16.onnx' },
};

if (process.platform !== 'win32') {
  console.log('fetch-bundle: Windows only for now; nothing bundled.');
  process.exit(0);
}
if (process.argv.includes('--clean')) {
  for (const name of readdirSync(OUT)) if (name !== 'README.md') rmSync(join(OUT, name), { recursive: true, force: true });
}
mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });

async function download({ url, file }) {
  const target = join(CACHE, file);
  if (existsSync(target) && statSync(target).size > 0) return target;
  process.stdout.write(`downloading ${file} … `);
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'bhippi-fetch-bundle' } });
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
  const expected = Number(response.headers.get('content-length') ?? 0);
  const part = `${target}.part`;
  const out = createWriteStream(part);
  let got = 0;
  for await (const chunk of response.body) {
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((done) => out.once('drain', done));
  }
  await new Promise((done, fail) => out.end((error) => (error ? fail(error) : done())));
  if (expected && got !== expected) throw new Error(`${file}: got ${got} of ${expected} bytes`);
  renameSync(part, target);
  console.log(`${(got / 1e6).toFixed(1)} MB`);
  return target;
}

/** Unpacks a zip with Windows' own tar (bsdtar), as Bhippi does at runtime. */
function unzip(archive, into) {
  mkdirSync(into, { recursive: true });
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(existsSync(tar) ? tar : 'tar', ['-xf', archive, '-C', into], { stdio: 'inherit' });
}

const sha256 = (path) => createHash('sha256').update(execFileSync('cmd', ['/c', 'type', path], { maxBuffer: 1 << 30, encoding: 'buffer' })).digest('hex');

// ─── FFmpeg + FFprobe (with their DLLs), yt-dlp ─────────────────────────────────────────────
const bin = join(OUT, 'bin');
mkdirSync(bin, { recursive: true });
if (!existsSync(join(bin, 'ffmpeg.exe'))) {
  const zip = await download(SOURCES.ffmpeg);
  const temp = join(CACHE, 'ffmpeg-unpacked');
  rmSync(temp, { recursive: true, force: true });
  unzip(zip, temp);
  const top = readdirSync(temp).find((name) => existsSync(join(temp, name, 'bin', 'ffmpeg.exe')));
  if (!top) throw new Error('ffmpeg.exe not found in the FFmpeg archive');
  for (const name of readdirSync(join(temp, top, 'bin'))) {
    if (name === 'ffplay.exe') continue; // not used; saves space
    cpSync(join(temp, top, 'bin', name), join(bin, name));
  }
  mkdirSync(join(OUT, 'licenses'), { recursive: true });
  if (existsSync(join(temp, top, 'LICENSE.txt'))) cpSync(join(temp, top, 'LICENSE.txt'), join(OUT, 'licenses', 'FFmpeg-LICENSE.txt'));
  writeFileSync(join(OUT, 'licenses', 'FFmpeg-SOURCE.txt'), `FFmpeg (GPL build by BtbN/FFmpeg-Builds) is shipped unmodified as separate programs.\nBinaries: ${SOURCES.ffmpeg.url}\nSource: https://github.com/FFmpeg/FFmpeg (release/8.1) and https://github.com/BtbN/FFmpeg-Builds\n`);
  rmSync(temp, { recursive: true, force: true });
}
if (!existsSync(join(bin, 'yt-dlp.exe'))) cpSync(await download(SOURCES.ytdlp), join(bin, 'yt-dlp.exe'));

// ─── Speech engines and Roto models, laid out as in the models folder ───────────────────────
const models = join(OUT, 'models');
const whisperDir = join(models, 'bin', 'whisper');
if (!existsSync(whisperDir)) unzip(await download(SOURCES.whisper), whisperDir);
const piperDir = join(models, 'bin', 'piper');
if (!existsSync(piperDir)) unzip(await download(SOURCES.piper), piperDir);
const matte = join(models, 'matte');
mkdirSync(matte, { recursive: true });
for (const source of [SOURCES.rvm32, SOURCES.rvm16]) {
  if (!existsSync(join(matte, source.file))) cpSync(await download(source), join(matte, source.file));
}

// ─── A manifest Bhippi and the release notes read ──────────────────────────────────────────
function size(path) {
  const stat = statSync(path);
  return stat.isDirectory() ? readdirSync(path).reduce((sum, name) => sum + size(join(path, name)), 0) : stat.size;
}
const manifest = {
  builtAt: new Date().toISOString(),
  sources: SOURCES,
  ffmpegSha256: sha256(join(bin, 'ffmpeg.exe')),
  sizeMb: Math.round(size(OUT) / 1e6),
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`bundled: ${manifest.sizeMb} MB in ${OUT}`);
