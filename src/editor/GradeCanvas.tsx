// The Color Studio in the preview: a video or still drawn through its grade's 3D LUT on the GPU.
//
// The grade is baked once per change into the same 33³ table the export hands ffmpeg's lut3d
// (lib/effectExport.ts), and both sample it trilinearly — so hue curves, Color Slice and LUTs look
// here exactly as they render. The source element stays in the page, hidden, and is uploaded as a
// texture whenever it shows a new frame (the same pattern as RotoPreview and MagicMaskLayer).
//
// Adjustment layers above a clip hand their grades down through GradeScope; the clip's own grade
// runs first, then each adjustment from the nearest up, each mixed by the adjustment's opacity.

import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { sampleLut, type ColorParams, type Lut3D } from '../lib/colorGrade';
import { bakedGrade } from '../lib/luts';

// ───────────────────────────── baking, cached ─────────────────────────────

/** A grade's baked LUT (shared with the scopes, lib/luts.ts). */
export const gradeLut = (params: ColorParams) => bakedGrade(params);

/** One grade in a layer's chain: its LUT and how much of it shows (an adjustment's opacity). */
export type GradeStep = { key: string; lut: Lut3D; mix: number };
/** The chain as one texture: the steps composed in order. */
export type GradeSpec = { key: string; lut: Lut3D };

const composed = new Map<string, GradeSpec>();

export function composeGrades(steps: GradeStep[]): GradeSpec | null {
  if (!steps.length) return null;
  if (steps.length === 1 && steps[0].mix >= 1) return { key: steps[0].key, lut: steps[0].lut };
  const key = steps.map((step) => `${step.key}@${step.mix.toFixed(3)}`).join('>');
  const hit = composed.get(key);
  if (hit) return hit;
  const size = steps[0].lut.size;
  const data = new Float32Array(size ** 3 * 3);
  const value = [0, 0, 0], graded = [0, 0, 0];
  let k = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    value[0] = r / (size - 1); value[1] = g / (size - 1); value[2] = b / (size - 1);
    for (const step of steps) {
      sampleLut(step.lut, value[0], value[1], value[2], graded);
      for (let c = 0; c < 3; c++) value[c] += (graded[c] - value[c]) * step.mix;
    }
    data[k++] = value[0]; data[k++] = value[1]; data[k++] = value[2];
  }
  const spec = { key, lut: { size, data } };
  composed.set(key, spec);
  while (composed.size > 24) composed.delete(composed.keys().next().value!);
  return spec;
}

// ───────────────────────────── adjustment layers hand grades down ─────────────────────────────

/** A graded adjustment layer above: its step, and the filter that approximates it on layers the GPU does not draw. */
export type InheritedGrade = GradeStep & { filters: string[] };

export const GradeScope = createContext<InheritedGrade[]>([]);

/** Wraps the layers below a graded adjustment layer: its grade comes before any from further up. */
export function GradeScopeWrap({ entry, children }: { entry: InheritedGrade; children: ReactNode }) {
  const outer = useContext(GradeScope);
  return <GradeScope.Provider value={[entry, ...outer]}>{children}</GradeScope.Provider>;
}

// ───────────────────────────── whether the GPU path works here ─────────────────────────────

let gpuGrade = typeof document !== 'undefined';
const listeners = new Set<() => void>();
function gpuFailed(reason: unknown) {
  if (!gpuGrade) return;
  console.warn('Color Studio: GPU grading unavailable, falling back to filters', reason);
  gpuGrade = false;
  listeners.forEach((listener) => listener());
}
/** Whether graded clips are drawn by the GPU pass (false after WebGL2 fails once). */
export function useGpuGrade(): boolean {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => gpuGrade, () => false);
}

// ───────────────────────────── the pass ─────────────────────────────

const VERTEX = `#version 300 es
in vec2 p;
out vec2 v;
void main() { v = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 v;
out vec4 o;
uniform sampler2D src;
uniform sampler3D lut;
uniform float scale;
uniform float offset;
void main() {
  vec4 c = texture(src, v);
  vec3 graded = texture(lut, clamp(c.rgb, 0.0, 1.0) * scale + offset).rgb;
  o = vec4(graded * c.a, c.a);
}`;

type Pass = { gl: WebGL2RenderingContext; src: WebGLTexture; lut: WebGLTexture; scale: WebGLUniformLocation | null; offset: WebGLUniformLocation | null };

function createPass(canvas: HTMLCanvasElement): Pass {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 is not available');
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader failed');
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program failed');
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const src = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const lut = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_3D, lut);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.uniform1i(gl.getUniformLocation(program, 'src'), 0);
  gl.uniform1i(gl.getUniformLocation(program, 'lut'), 1);
  return { gl, src, lut, scale: gl.getUniformLocation(program, 'scale'), offset: gl.getUniformLocation(program, 'offset') };
}

type Source = HTMLVideoElement | HTMLImageElement;

/**
 * Draws `source()` through `grade` into a canvas that fills the layer. Redraws on a new decoded
 * frame, a new grade or a new size — never otherwise, so a parked frame costs nothing.
 */
export function GradeCanvas({ source, grade, quality = 1 }: { source: () => Source | null; grade: GradeSpec; quality?: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const latest = useRef({ source, grade, quality });
  latest.current = { source, grade, quality };

  useEffect(() => {
    const box = holder.current;
    if (!box) return;
    // A canvas of its own per mount, so releasing its context on unmount can never hand a lost
    // context to the next mount.
    const output = document.createElement('canvas');
    output.className = 'layer-media graded-media';
    Object.assign(output.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    box.appendChild(output);
    let pass: Pass | null;
    try {
      pass = createPass(output);
    } catch (error) {
      gpuFailed(error);
      output.remove();
      return;
    }
    let stopped = false;
    let frame = 0;
    let uploadedLut = '';
    let drawn = '';
    const draw = () => {
      if (stopped) return;
      frame = requestAnimationFrame(draw);
      if (!pass) return;
      const { source: get, grade: spec, quality: q } = latest.current;
      const media = get();
      if (!media) return;
      const video = media instanceof HTMLVideoElement ? media : null;
      if (video ? video.readyState < 2 : !(media as HTMLImageElement).complete || !(media as HTMLImageElement).naturalWidth) return;
      const natW = video ? video.videoWidth : (media as HTMLImageElement).naturalWidth;
      const natH = video ? video.videoHeight : (media as HTMLImageElement).naturalHeight;
      // The layer box at the preview quality, never more pixels than the source has.
      const scale = q * (window.devicePixelRatio || 1);
      const width = Math.max(1, Math.min(natW, Math.round((box.clientWidth || natW) * scale)));
      const height = Math.max(1, Math.min(natH, Math.round((box.clientHeight || natH) * scale)));
      const key = `${video ? video.currentTime : (media as HTMLImageElement).src}|${spec.key}|${width}x${height}`;
      if (key === drawn) return;
      const { gl } = pass;
      if (output.width !== width || output.height !== height) { output.width = width; output.height = height; }
      try {
        if (uploadedLut !== spec.key) {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_3D, pass.lut);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, spec.lut.size, spec.lut.size, spec.lut.size, 0, gl.RGB, gl.FLOAT, spec.lut.data);
          gl.uniform1f(pass.scale, (spec.lut.size - 1) / spec.lut.size);
          gl.uniform1f(pass.offset, 0.5 / spec.lut.size);
          uploadedLut = spec.key;
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, pass.src);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media);
        gl.viewport(0, 0, width, height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        drawn = key;
      } catch (error) {
        // A cross-origin source: no clip can be graded this way, so the filter path takes over.
        stopped = true;
        gpuFailed(error);
      }
    };
    // Too many contexts at once makes the browser drop the oldest; take it back when it is restored.
    const lost = (event: Event) => { event.preventDefault(); pass = null; };
    const restored = () => {
      try { pass = createPass(output); uploadedLut = ''; drawn = ''; } catch (error) { gpuFailed(error); }
    };
    output.addEventListener('webglcontextlost', lost);
    output.addEventListener('webglcontextrestored', restored);
    frame = requestAnimationFrame(draw);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      output.removeEventListener('webglcontextlost', lost);
      output.removeEventListener('webglcontextrestored', restored);
      pass?.gl.getExtension('WEBGL_lose_context')?.loseContext();
      output.remove();
    };
  }, []);

  return <div ref={holder} className="graded-holder" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />;
}

/** A still drawn through its grade: the image stays in the page, hidden, as the texture source. */
export function GradedImage({ src, grade, quality }: { src: string; grade: GradeSpec; quality?: number }) {
  const image = useRef<HTMLImageElement>(null);
  return (
    <>
      <img ref={image} className="layer-media" src={src} alt="" crossOrigin="anonymous" draggable={false} style={{ visibility: 'hidden' }} />
      <GradeCanvas source={() => image.current} grade={grade} quality={quality} />
    </>
  );
}

/** The video element a pooled media holder currently shows. */
export const holderVideo = (holder: RefObject<HTMLDivElement | null>) => () => holder.current?.querySelector('video') ?? null;
