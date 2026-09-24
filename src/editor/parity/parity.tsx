// Dev-only harness (export-parity.html): draws one frame of a project with the Program monitor's
// compositor, in a plain browser, so Playwright can screenshot it next to the FFmpeg export of the
// same frame (see render/e2e.rs `parity_frames`). Local files come from a CORS file server given
// by ?media=http://127.0.0.1:8767 that serves the drive root ("C:\a\b.mp4" → "/a/b.mp4").
//
// Page API (for the driver): `window.parity.prepare(project, compId)` → the project exactly as the
// export receives it (effect tables baked in); `window.parity.show(caseJson, time)` draws a frame
// and resolves once every video has its frame and motion layers have painted.
const params = new URLSearchParams(location.search);
const media = params.get('media') ?? 'http://127.0.0.1:8767';
const frames = params.get('frames') ?? 'C:/parity-frames';
let renders = 0;
const toUrl = (path: string) => `${media}/${path.replace(/^[A-Za-z]:[\\/]/, '').replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}`;
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  convertFileSrc: (path: string) => toUrl(path),
  // The export's frame pre-render talks to two commands; frames go to the file server by PUT.
  invoke: async (cmd: string, args: unknown, options?: { headers?: Record<string, string> }) => {
    if (cmd === 'mogrt_frames_begin') return `${frames}/${(args as { clipId: string }).clipId}-${++renders}`;
    // Roto mattes (motion scene cutouts): the run's roto.json under ?roto=<the app's roto folder>.
    if (cmd === 'roto_read') {
      const root = params.get('roto');
      if (!root) return null;
      const response = await fetch(toUrl(`${root}/${(args as { id: string }).id}/roto.json`));
      return response.ok ? response.json() : null;
    }
    if (cmd === 'mogrt_frame_write') {
      // The header carries only the folder's name, as the app's Rust side expects.
      const dir = `${frames}/${options?.headers?.['x-mogrt-dir'] ?? ''}`;
      const index = Number(options?.headers?.['x-mogrt-index'] ?? 0);
      const response = await fetch(toUrl(`${dir}/${String(index).padStart(5, '0')}.png`), { method: 'PUT', body: args as Uint8Array });
      if (!response.ok) throw new Error(`frame upload failed: ${response.status}`);
      return null;
    }
    return null;
  },
  transformCallback: () => 0,
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
};

const [{ createElement }, { createRoot }, { CompLayers }, { prepareEffectExport }, { renderMotionGraphicsForExport }, { renderMotionScenesForExport }] = await Promise.all([
  import('react'),
  import('react-dom/client'),
  import('../Compositor'),
  import('../../lib/effectExport'),
  import('../../lib/htmlFrames'),
  import('../../motion/exportFrames'),
]);
import type { Asset, Project } from '../../lib/types';
import '../../styles/app.css';

type Case = { project: Project; assets: Asset[]; compId: string };

const stage = document.getElementById('stage') as HTMLDivElement;
const root = createRoot(stage);
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function settle() {
  const deadline = performance.now() + 15000;
  for (;;) {
    await frame();
    const videos = [...document.querySelectorAll('video')].filter((video) => video.style.visibility !== 'hidden');
    const ready = videos.every((video) => video.readyState >= 2 && !video.seeking);
    const images = [...document.querySelectorAll('img')].every((image) => image.complete);
    if ((ready && images) || performance.now() > deadline) break;
  }
  for (let i = 0; i < 8; i++) await frame();
  // Motion scenes load their footage inside the engine (no <video> in the DOM): wait until
  // every motion canvas has stopped changing for half a second.
  const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.motion-layer canvas')];
  if (!canvases.length) return;
  const probe = document.createElement('canvas');
  probe.width = 64;
  probe.height = 36;
  const ctx = probe.getContext('2d', { willReadFrequently: true })!;
  const sample = () => canvases.map((canvas) => { ctx.clearRect(0, 0, 64, 36); ctx.drawImage(canvas, 0, 0, 64, 36); return ctx.getImageData(0, 0, 64, 36).data.join(','); }).join('|');
  let last = sample();
  let still = performance.now();
  const until = performance.now() + 10000;
  while (performance.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const next = sample();
    if (next !== last) { last = next; still = performance.now(); } else if (performance.now() - still > 600) break;
  }
}

async function show(data: Case, time: number) {
  const comp = data.project.comps.find((entry) => entry.id === data.compId)!;
  stage.style.width = `${comp.width}px`;
  stage.style.height = `${comp.height}px`;
  const assets = new Map(data.assets.map((asset) => [asset.id, asset]));
  root.render(createElement(CompLayers, { project: data.project, assets, offline: new Set<string>(), playing: false, rate: 1, comp, time, stageW: comp.width, stageH: comp.height, depth: 0, quality: 1 }));
  await settle();
  return true;
}

/** The project as the export receives it: HTML graphics and motion scenes rendered to frames, effect tables baked in. */
async function prepare(project: Project, compId: string, assets: Asset[] = []) {
  const graphics = await renderMotionGraphicsForExport(project, compId);
  const scenes = await renderMotionScenesForExport(graphics, compId, assets);
  return prepareEffectExport(scenes, compId);
}

(window as unknown as { parity: unknown }).parity = { show, prepare };
document.title = 'parity ready';
