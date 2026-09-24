// Dev-only harness (motion-lab.html): renders motion scenes in a plain browser so the engine can
// be checked frame by frame with Playwright, outside the desktop app. Media comes from a local
// CORS file server given by ?media=http://127.0.0.1:8765.
import { rasterizeUi } from '../ui/raster';
import { compileUi } from '../ui/compile';
import type { UiScreenSpec } from '../ui/spec';
import { DEMO_UI } from '../ui/demo';
import { compileSequence, type SequenceSpec } from '../sequence';
import { expandIcons } from '../vector/icons';
import '../../fonts/bundled.css';
import { MotionRenderer } from '../gl/renderer';
import type { MediaHost } from '../sources';
import type { MotionScene } from '../types';
import { LAB_SCENES } from './scenes';

const params = new URLSearchParams(location.search);
const media = params.get('media') ?? 'http://127.0.0.1:8765';

const host: MediaHost = {
  resolve(source) {
    const path = source.path ?? source.asset ?? '';
    if (!path) return null;
    const url = /^(https?|data|blob):/.test(path) ? path : `${media}/${path}`;
    return { url, kind: source.kind ?? (/\.(png|jpe?g|webp)$/i.test(path) ? 'image' : 'video') };
  },
  async matte(path) {
    // Lab mattes are folders of numbered PNGs: "<folder>@<fps>@<frames>".
    const [folder, fps, frames, first] = path.split('@');
    return { fps: Number(fps), frames: Number(frames), first: Number(first ?? 0) || 0, frameUrl: (i: number) => `${media}/${folder}/${String(i + 1).padStart(5, '0')}.png` };
  },
  file: (path) => (/^(https?|data|blob):/.test(path) ? path : `${media}/${path}`),
};

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const renderer = new MotionRenderer(canvas, host);

async function frame(scene: MotionScene, t: number, scale: number) {
  await renderer.bank.prepareExact(scene, t);
  renderer.draw(scene, t, { scale, fps: 30 });
  return canvas.toDataURL('image/jpeg', 0.9);
}

/** Renders `times` of a scene into one contact sheet (cols × rows), returns a JPEG data URL. */
async function sheet(name: string, times: number[], scale = 0.25, cols = 4) {
  const scene = LAB_SCENES[name]();
  const w = Math.round(scene.width * scale);
  const h = Math.round(scene.height * scale);
  const rows = Math.ceil(times.length / cols);
  const out = document.createElement('canvas');
  out.width = w * cols;
  out.height = h * rows;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, out.width, out.height);
  const started = performance.now();
  for (const [i, t] of times.entries()) {
    await renderer.bank.prepareExact(scene, t);
    renderer.draw(scene, t, { scale, fps: 30 });
    ctx.drawImage(canvas, (i % cols) * w, Math.floor(i / cols) * h, w, h);
    ctx.fillStyle = '#ff0';
    ctx.font = '12px monospace';
    ctx.fillText(t.toFixed(2), (i % cols) * w + 4, Math.floor(i / cols) * h + 14);
  }
  return { url: out.toDataURL('image/jpeg', 0.88), ms: Math.round(performance.now() - started) };
}

async function timing(name: string, t: number, scale = 1, n = 10) {
  const scene = LAB_SCENES[name]();
  await renderer.bank.prepareExact(scene, t);
  renderer.draw(scene, t, { scale });
  const gl = renderer.gl.gl;
  const px = new Uint8Array(4);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { renderer.draw(scene, t + i / 300, { scale }); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  return (performance.now() - t0) / n;
}

/**
 * The export path, minus Tauri: frame-exact render → straight-alpha pixels → PNG, uploaded to the
 * media server under upload/<name>/%05d.png (the same bytes exportFrames.ts hands the exporter).
 */
async function exportTest(name: string, fps = 30, seconds?: number) {
  const scene = LAB_SCENES[name]();
  const frames = Math.round((seconds ?? scene.duration) * fps);
  const offscreen = new OffscreenCanvas(16, 16);
  const exporter = new MotionRenderer(offscreen, host);
  const started = performance.now();
  for (let i = 0; i < frames; i++) {
    const t = i / fps;
    await exporter.bank.prepareExact(scene, t);
    const px = exporter.pixels(scene, t, { scale: 1, fps, motionBlur: true });
    const c = new OffscreenCanvas(px.width, px.height);
    c.getContext('2d')!.putImageData(new ImageData(px.data, px.width, px.height), 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    await fetch(`${media}/upload/${name}/${String(i + 1).padStart(5, '0')}.png`, { method: 'PUT', body: blob });
  }
  exporter.dispose();
  return { frames, ms: Math.round(performance.now() - started) };
}

/** Loads scenes exported from a real project (a JSON list of {title, scene}) as user-0, user-1, … */
async function loadUser(url: string) {
  const list = (await (await fetch(url)).json()) as { title: string; scene: MotionScene }[];
  list.forEach((entry, i) => { LAB_SCENES[`user-${i}`] = () => entry.scene; });
  return list.map((entry, i) => `user-${i}: ${entry.title}`);
}

/** Builds a UI screen (src/motion/ui) the way create_ui_screen does, pictures as blob URLs, as scene `name`. */
async function ui(spec: UiScreenSpec = DEMO_UI, name = 'ui', stage = '#e9ecf5') {
  const raster = await rasterizeUi(spec, async (bytes) => URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' })));
  const built = compileUi(spec, raster, { width: 1920, height: 1080 });
  const scene = await expandIcons({ version: 1, width: 1920, height: 1080, duration: built.duration, background: stage, layers: [built.layer], cues: built.cues });
  LAB_SCENES[name] = () => scene;
  return { duration: built.duration, cues: built.cues, parts: raster.states.map((s) => ({ state: s.id, parts: s.parts.map((p) => ({ id: p.id, box: p.box, parent: p.parent, text: p.text })) })) };
}

/** Compiles a motion sequence (src/motion/sequence.ts) as scene `name`. */
function seq(spec: SequenceSpec, name = 'seq') {
  const built = compileSequence(spec);
  LAB_SCENES[name] = () => built.scene;
  return { duration: built.duration, starts: built.starts, cuts: built.cuts, layers: built.scene.layers.map((l) => l.id) };
}

Object.assign(window, { lab: { ui, seq, loadUser, exportTest, frame: (name: string, t: number, scale = 0.5) => frame(LAB_SCENES[name](), t, scale), sheet, timing, scenes: Object.keys(LAB_SCENES) } });
document.title = 'Motion Lab ready';
