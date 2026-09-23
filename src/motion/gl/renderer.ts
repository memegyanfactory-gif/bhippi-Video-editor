// The motion engine's GPU executor: draws a MotionScene at one moment. The same code serves the
// Program monitor (drawn to its canvas every tick) and the export (drawn off-screen, read back
// as PNG frames the FFmpeg exporter overlays), so what the preview shows is what exports.
import { evaluateScene, defaultSize, resolveEffect, type ResolvedFrame, type ResolvedLayer } from '../evaluate';
import { num } from '../anim';
import { multiply, scaling, transformPoint, type Mat4 } from '../math';
import { MediaBank, sourceTime, type MediaHost } from '../sources';
import type { TextFrame } from '../text';
import type { Layer, MotionScene } from '../types';
import { BLEND_MODES } from '../types';
import { parseColor } from './color';
import { GL, type Target } from './core';
import { applyEffects, blur, effectPad, type EffectEnv } from './effects';
import { CanvasCache, rasterMasks, rasterShape, rasterText, textFrame } from './raster';
import * as S from './shaders';
import { proceduralUniforms } from './procedural';

export type RenderOptions = {
  /** Output pixels per scene pixel (preview resolution); 1 for export. */
  scale?: number;
  fps?: number;
  motionBlur?: boolean;
};

type Content = { target: Target; pad: number; density: number; size: [number, number] };

const MATTE_FX = new Set(['subject-reveal', 'matte-fill', 'matte-edge-glow']);
const MAX_DEPTH = 6;

const f32 = (m: Mat4) => Float32Array.from(m);

/** Pixels of layer content per layer pixel, from how big the layer lands on screen. */
function densityOf(layer: ResolvedLayer, scale: number, maxTexture: number): number {
  const [w, h] = layer.size;
  if (w <= 0 || h <= 0) return scale;
  const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => transformPoint(layer.matrix, x, y, 0));
  const front = corners.filter((p) => p[3] > 1e-6);
  if (!front.length) return 0;
  const pts = front.map((p) => [p[0] / p[3], p[1] / p[3]]);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const ratio = Math.sqrt(Math.abs(area / 2) / (w * h));
  const d = Math.min(4, Math.max(0.08, ratio * scale * 1.05));
  return Math.min(d, maxTexture / Math.max(w, h));
}

export class MotionRenderer {
  readonly gl: GL;
  readonly bank: MediaBank;
  private canvases = new CanvasCache();
  private uploads = new Map<string, WebGLTexture>();
  private textCache = new Map<string, TextFrame>();
  private textSignatures = new Map<string, { signature: string; size: [number, number] }>();

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas, host: MediaHost) {
    this.gl = new GL(canvas);
    this.bank = new MediaBank(host);
  }

  private upload(key: string, source: TexImageSource): WebGLTexture {
    const tex = this.gl.upload(source, this.uploads.get(key));
    if (!this.uploads.has(key)) {
      this.uploads.set(key, tex);
      if (this.uploads.size > 96) {
        const [oldKey, oldTex] = this.uploads.entries().next().value!;
        this.uploads.delete(oldKey);
        this.gl.deleteTexture(oldTex);
      }
    }
    return tex;
  }

  /** A texture as a pooled target of the given size (so effects can chain on it). */
  private fromTexture(tex: WebGLTexture, w: number, h: number): Target {
    const target = this.gl.acquire(w, h);
    this.gl.pass('copy', S.COPY_FS, target, { uTex: tex, uOpacity: 1 });
    return target;
  }

  private text(scene: MotionScene, layer: Layer & { type: 'text' }, t: number, index: number): TextFrame {
    const key = `${layer.id}@${t.toFixed(5)}`;
    let frame = this.textCache.get(key);
    if (!frame) {
      frame = textFrame(layer.text, t, { seed: scene.seed ?? 1, index, duration: scene.duration, width: scene.width, height: scene.height });
      this.textCache.set(key, frame);
      if (this.textCache.size > 256) this.textCache.delete(this.textCache.keys().next().value!);
    }
    return frame;
  }

  /** Grows a content target by `extra` layer pixels on every side. */
  private grow(target: Target, density: number, extra: number): Target {
    const e = Math.ceil(extra * density);
    if (e <= 0) return target;
    const out = this.gl.acquire(target.w + e * 2, target.h + e * 2);
    this.gl.pass('rect', S.RECT_FS, out, { uTex: target.tex, uRect: [e / out.w, e / out.h, target.w / out.w, target.h / out.h] });
    this.gl.release(target);
    return out;
  }

  private content(scene: MotionScene, frame: ResolvedFrame, L: ResolvedLayer, scale: number, depth: number, fps: number, forMatteOnly = false): Content | null {
    const gl = this.gl;
    const layer = L.layer;
    void frame;
    const density = densityOf(L, scale, gl.maxTexture);
    if (density <= 0) return null;
    const [w, h] = L.size;
    const W = Math.max(1, Math.round(w * density));
    const H = Math.max(1, Math.round(h * density));
    let target: Target | null = null;
    let pad = 0;
    let matte: Target | null = null;
    let footage: Target | null = null;
    const wantsMatteFx = !forMatteOnly && L.effects.some((e) => MATTE_FX.has(e.type));

    switch (layer.type) {
      case 'solid': {
        target = gl.acquire(W, H);
        gl.pass('solid', S.SOLID_FS, target, { uColor: parseColor(layer.color) });
        break;
      }
      case 'procedural': {
        target = gl.acquire(W, H);
        // Params may be keyframed like any effect param (light-rails progress, hex highlight…).
        const params = resolveEffect({ type: 'fill', ...(layer.params ?? {}) } as never, L.time, { seed: scene.seed ?? 1, index: L.index }).params;
        gl.pass('procedural', S.PROCEDURAL_FS, target, proceduralUniforms(layer.kind, params, L.time, [w, h]));
        break;
      }
      case 'footage': {
        const time = sourceTime(layer.source, L.time);
        const picture = this.bank.frame(layer.source, time);
        if (!picture) return null;
        const tex = this.upload(`f:${picture.key.split('@')[0]}`, picture.image);
        const fit = layer.fit ?? 'cover';
        const sw = picture.width;
        const sh = picture.height;
        const k = fit === 'none' ? 1 : fit === 'contain' ? Math.min(w / sw, h / sh) : Math.max(w / sw, h / sh);
        const dw = sw * k;
        const dh = sh * k;
        const uFit = [((dw - w) / 2) / dw, ((dh - h) / 2) / dh, w / dw, h / dh];
        const matteFrame = layer.source.matte ? this.bank.matteFrame(layer.source.matte, time) : null;
        const matteTex = matteFrame ? this.upload(`m:${layer.id}`, matteFrame.image) : null;
        target = gl.acquire(W, H);
        gl.pass('footage', S.FOOTAGE_FS, target, { uTex: tex, uMatte: matteTex, uFit, uHasMatte: matteTex ? 1 : 0, uCutout: layer.source.cutout && !wantsMatteFx ? 1 : 0, uMatteMode: 0 });
        if (layer.source.cutout && layer.source.matte && !matteTex) {
          // The subject matte is still loading: draw nothing rather than the uncut picture.
          gl.release(target);
          return null;
        }
        if (wantsMatteFx && matteTex) {
          matte = gl.acquire(W, H);
          gl.pass('footage', S.FOOTAGE_FS, matte, { uTex: tex, uMatte: matteTex, uFit, uHasMatte: 1, uCutout: 0, uMatteMode: 1 });
        }
        break;
      }
      case 'text': {
        const tf = this.text(scene, layer, L.time, L.index);
        // Settled type is the common case: re-raster only when some glyph actually changed.
        const signature = `${density.toFixed(3)}|${tf.width}x${tf.height}|${tf.glyphs.map((g) => `${g.ch}${g.color}${(g.dx).toFixed(2)},${(g.dy).toFixed(2)},${g.scale.toFixed(4)},${g.rotation.toFixed(2)},${g.opacity.toFixed(3)},${g.blur.toFixed(2)},${g.skew.toFixed(2)}`).join(';')}|${tf.strikes.map((k) => k.progress.toFixed(3)).join(',')}`;
        const key = `t:${layer.id}`;
        const cached = this.textSignatures.get(key);
        let tex: WebGLTexture;
        let size: [number, number];
        if (cached && cached.signature === signature && this.uploads.has(key)) {
          tex = this.uploads.get(key)!;
          size = cached.size;
        } else {
          const canvas = rasterText(this.canvases, layer.id, layer.text, tf, density);
          tex = this.upload(key, canvas);
          size = [canvas.width, canvas.height];
          this.textSignatures.set(key, { signature, size });
        }
        target = this.fromTexture(tex, size[0], size[1]);
        pad = tf.pad;
        break;
      }
      case 'shape': {
        const { canvas, pad: shapePad } = rasterShape(this.canvases, layer.id, layer.shape, [w, h], L.time, density, { seed: scene.seed ?? 1, index: L.index });
        target = this.fromTexture(this.upload(`s:${layer.id}`, canvas), canvas.width, canvas.height);
        pad = shapePad;
        break;
      }
      case 'precomp': {
        if (depth >= MAX_DEPTH) return null;
        target = this.renderScene(layer.scene, L.time, density, depth + 1, { fps, motionBlur: true });
        break;
      }
      default:
        return null;
    }
    if (!target) return null;

    if (L.masks.length) {
      const maskCanvas = rasterMasks(this.canvases, layer.id, L.masks, [w, h], pad, density);
      const maskTex = this.upload(`k:${layer.id}`, maskCanvas);
      const masked = gl.acquire(target.w, target.h);
      gl.pass('mulmask', S.MUL_MASK_FS, masked, { uTex: target.tex, uMask: maskTex });
      gl.release(target);
      target = masked;
    }

    if (!forMatteOnly && L.effects.length) {
      const extra = Math.max(0, ...L.effects.map(effectPad));
      if (extra > 0) {
        target = this.grow(target, density, extra);
        if (matte) matte = this.grow(matte, density, extra);
        pad += Math.ceil(extra * density) / density;
      }
      if (wantsMatteFx) {
        footage = gl.acquire(target.w, target.h);
        gl.pass('copy', S.COPY_FS, footage, { uTex: target.tex, uOpacity: 1 });
      }
      const env: EffectEnv = { density, time: L.time, fps, seed: scene.seed ?? 1, matte, footage, size: [w, h], pad };
      const out = applyEffects(gl, target, L.effects, env);
      if (out !== target) gl.release(target);
      target = out;
    }
    gl.release(matte);
    gl.release(footage);
    return { target, pad, density, size: [w, h] };
  }

  /** Draws a layer's content into a transparent comp-sized target (with motion blur). */
  private place(scene: MotionScene, frame: ResolvedFrame, L: ResolvedLayer, scale: number, W: number, H: number, depth: number, fps: number, forMatteOnly = false, into?: Target): Target | null {
    const content = this.content(scene, frame, L, scale, depth, fps, forMatteOnly);
    if (!content) return null;
    const gl = this.gl;
    // `into`: draw straight onto an existing target (the plain normal-blend case) — no
    // comp-sized intermediate per layer, which is what made 70-layer scenes slow.
    const placed = into ?? gl.acquire(W, H);
    const S2 = scaling(scale, scale, 1);
    const rect = [-content.pad, -content.pad, content.size[0] + content.pad * 2, content.size[1] + content.pad * 2];
    const matrices = L.blurMatrices.length ? L.blurMatrices : [L.matrix];
    const opacity = L.opacity / matrices.length;
    for (const m of matrices) {
      gl.place('place', S.PLACE_FS, placed, { uMatrix: f32(multiply(S2, m)), uRect: rect, uTex: content.target.tex, uOpacity: opacity }, matrices.length > 1 ? 'add' : 'over');
    }
    gl.release(content.target);
    return placed;
  }

  /** Renders `scene` at scene time `t` into a new target of (width × height) × scale. */
  renderScene(scene: MotionScene, t: number, scale: number, depth = 0, options: { fps?: number; motionBlur?: boolean } = {}): Target {
    const gl = this.gl;
    const fps = options.fps ?? 30;
    const W = Math.max(1, Math.round(scene.width * scale));
    const H = Math.max(1, Math.round(scene.height * scale));
    const sizeOf = (layer: Layer, time: number): [number, number] => {
      if (layer.type === 'text') {
        // Layer space is the unpadded text block: the animation padding lives only in the quad,
        // so anchors and positions do not drift while glyphs blur or fly in.
        const tf = this.text(scene, layer, time, scene.layers.indexOf(layer));
        return [Math.max(1, tf.width - tf.pad * 2), Math.max(1, tf.height - tf.pad * 2)];
      }
      return defaultSize(scene, layer, time);
    };
    const anchorOf = (layer: Layer, size: [number, number], time: number) => {
      void time;
      if (layer.type !== 'text' || !layer.text.align || layer.text.align === 'center') return null;
      return [layer.text.align === 'left' ? 0 : size[0], size[1] / 2, 0];
    };
    const frame = evaluateScene(scene, t, { sizeOf, anchorOf, fps, motionBlur: options.motionBlur !== false });
    let acc = gl.acquire(W, H);
    if (scene.background) {
      const c = parseColor(scene.background);
      gl.clear(acc, [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]]);
    }
    const matteSources = new Set(scene.layers.map((l) => l.matte?.layer).filter((id): id is string => !!id));
    for (const index of frame.order) {
      const L = frame.layers[index];
      const layer = L.layer;
      if (!L.active || L.opacity <= 0) continue;
      if (layer.hidden || (matteSources.has(layer.id) && layer.hidden !== false)) continue;

      if (layer.adjustment) {
        acc = this.adjust(scene, frame, L, acc, scale, W, H, depth, fps);
        continue;
      }

      const plain = (layer.blend ?? 'normal') === 'normal' && !layer.matte && !layer.backdrop && !L.blurMatrices.length;
      if (plain) {
        this.place(scene, frame, L, scale, W, H, depth, fps, false, acc);
        continue;
      }
      let placed = this.place(scene, frame, L, scale, W, H, depth, fps);
      if (!placed) continue;

      if (layer.matte) {
        const mode = layer.matte.mode;
        const source = frame.layers.find((entry) => entry.layer.id === layer.matte!.layer);
        const inverted = mode === 'alpha-inverted' || mode === 'luma-inverted';
        const mattePlaced = source && source.active ? this.place(scene, frame, source, scale, W, H, depth, fps) : null;
        if (!mattePlaced && !inverted) { gl.release(placed); continue; }
        if (mattePlaced) {
          const cut = gl.acquire(W, H);
          gl.pass('matte', S.MATTE_FS, cut, { uTex: placed.tex, uMatte: mattePlaced.tex, uMode: ['alpha', 'alpha-inverted', 'luma', 'luma-inverted'].indexOf(mode) });
          gl.release(placed);
          gl.release(mattePlaced);
          placed = cut;
        }
      }

      if (layer.backdrop) {
        const radius = num(layer.backdrop.blur, L.time, 24);
        const blurred = blur(gl, acc, radius * 0.5 * scale);
        const graded = gl.acquire(W, H);
        gl.pass('color', S.COLOR_FS, graded, { uTex: blurred.tex, uOp: 4, uA: [0, layer.backdrop.saturation ?? 1.2, (layer.backdrop.brightness ?? 0) / 100, 0], uB: [0, 0, 0, 0], uC: [0, 0, 0, 0] });
        gl.release(blurred);
        const mixed = gl.acquire(W, H);
        // A sheer glass card (alpha 0.1) must still frost fully: coverage saturates early.
        gl.pass('cover', S.COVER_MIX_FS, mixed, { uA: acc.tex, uB: graded.tex, uCover: placed.tex, uAmount: 12 });
        gl.release(graded);
        gl.release(acc);
        acc = mixed;
      }

      const mode = layer.blend ?? 'normal';
      if (mode === 'normal') {
        gl.pass('copy', S.COPY_FS, acc, { uTex: placed.tex, uOpacity: 1 }, 'over');
      } else {
        const out = gl.acquire(W, H);
        gl.pass('blend', S.BLEND_FS, out, { uDst: acc.tex, uSrc: placed.tex, uMode: Math.max(0, BLEND_MODES.indexOf(mode)) });
        gl.release(acc);
        acc = out;
      }
      gl.release(placed);
    }
    return acc;
  }

  /** An adjustment layer: its effects run on everything below, cut by its own coverage. */
  private adjust(scene: MotionScene, frame: ResolvedFrame, L: ResolvedLayer, acc: Target, scale: number, W: number, H: number, depth: number, fps: number): Target {
    const gl = this.gl;
    const coverageLayer: ResolvedLayer = { ...L, effects: [], layer: { ...L.layer, type: 'solid', color: '#ffffff', size: L.size } as Layer };
    const cover = this.place(scene, frame, coverageLayer, scale, W, H, depth, fps, true);
    if (!cover) return acc;
    const env: EffectEnv = { density: scale, time: L.time, fps, seed: scene.seed ?? 1, size: [scene.width, scene.height], pad: 0 };
    const fx = applyEffects(gl, acc, L.effects, env);
    const out = gl.acquire(W, H);
    gl.pass('cover', S.COVER_MIX_FS, out, { uA: acc.tex, uB: fx.tex, uCover: cover.tex, uAmount: 1 });
    if (fx !== acc) gl.release(fx);
    gl.release(cover);
    gl.release(acc);
    return out;
  }

  /** Renders and shows the frame on the renderer's own canvas (the preview). */
  draw(scene: MotionScene, t: number, options: RenderOptions = {}) {
    if (this.gl.lost) return;
    const scale = options.scale ?? 1;
    const target = this.renderScene(scene, t, scale, 0, options);
    const canvas = this.canvas;
    if (canvas.width !== target.w || canvas.height !== target.h) { canvas.width = target.w; canvas.height = target.h; }
    this.gl.clear(null);
    this.gl.pass('present', S.COPY_FS, null, { uTex: target.tex, uFlip: 1, uOpacity: 1 });
    this.gl.releaseAll();
  }

  /** Renders the frame and returns straight-alpha RGBA pixels, rows top-first (for PNG). */
  pixels(scene: MotionScene, t: number, options: RenderOptions = {}): { width: number; height: number; data: Uint8ClampedArray } {
    const target = this.renderScene(scene, t, options.scale ?? 1, 0, options);
    const straight = this.gl.acquire(target.w, target.h);
    this.gl.pass('unpremul', UNPREMUL_FS, straight, { uTex: target.tex });
    const data = this.gl.read(straight);
    const out = { width: target.w, height: target.h, data: new Uint8ClampedArray(data.buffer) };
    this.gl.releaseAll();
    return out;
  }

  dispose() {
    this.bank.dispose();
    for (const tex of this.uploads.values()) this.gl.deleteTexture(tex);
    this.uploads.clear();
    this.canvases.clear();
    this.gl.dispose();
  }
}

const UNPREMUL_FS = `${S.HEAD}
uniform sampler2D uTex;
void main() { vec4 c = texture(uTex, vUv); outColor = vec4(unpremul(c), c.a); }`;
