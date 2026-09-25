// Renders a Lottie file frame by frame into a PNG sequence with alpha — the importer's path for
// anything the native converter cannot reproduce exactly (convert.ts). Uses lottie-web's light
// canvas build: MIT, and free of eval / new Function, so it runs under the app's CSP.
import lottie from 'lottie-web/build/player/esm/lottie_light_canvas.min.js';

type J = Record<string, unknown>;
export type SavePicture = (bytes: Uint8Array, name: string) => Promise<string>;
export type RenderedLottie = { dir: string; frames: number; fps: number; width: number; height: number };

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export async function renderLottieFrames(json: J, save: SavePicture, options: { fps?: number; scale?: number; onProgress?: (done: number, total: number) => void } = {}): Promise<RenderedLottie> {
  const fr = Number(json.fr) || 30;
  const ip = Number(json.ip) || 0;
  const op = Number(json.op) || ip + fr * 2;
  const scale = options.scale ?? 1;
  const width = Math.round((Number(json.w) || 512) * scale);
  const height = Math.round((Number(json.h) || 512) * scale);
  const fps = options.fps ?? fr;
  const total = Math.max(1, Math.round(((op - ip) / fr) * fps));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas for the Lottie render');
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-30000px;top:0;width:${width}px;height:${height}px`;
  document.body.appendChild(host);
  const anim = lottie.loadAnimation({
    container: host,
    renderer: 'canvas',
    loop: false,
    autoplay: false,
    animationData: JSON.parse(JSON.stringify(json)),
    // Given a container, lottie-web draws into a canvas of its own there (a passed context is ignored).
    rendererSettings: { clearCanvas: true, preserveAspectRatio: 'xMidYMid meet' },
  });
  try {
    await new Promise<void>((resolve) => {
      if (anim.isLoaded) resolve();
      else { anim.addEventListener('DOMLoaded', () => resolve()); setTimeout(resolve, 3000); }
    });
    let dir = '';
    for (let i = 0; i < total; i++) {
      anim.goToAndStop((i / fps) * fr, true);
      await nextFrame();
      const drawn = host.querySelector('canvas');
      ctx.clearRect(0, 0, width, height);
      if (drawn) ctx.drawImage(drawn, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('a Lottie frame could not be encoded');
      const path = await save(new Uint8Array(await blob.arrayBuffer()), `${String(i + 1).padStart(5, '0')}.png`);
      if (i === 0) dir = path.replace(/[\\/][^\\/]+$/, '');
      options.onProgress?.(i + 1, total);
    }
    return { dir, frames: total, fps, width, height };
  } finally {
    anim.destroy();
    host.remove();
  }
}
