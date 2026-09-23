// WebGL2 plumbing for the motion engine: programs, render targets, texture uploads.
//
// Conventions every pass relies on:
// · All colour is premultiplied alpha, linear 8-bit (RGBA8) render targets.
// · Texture row 0 is the TOP of the picture, in uploaded images and in render targets alike:
//   passes write NDC y = −1 at the top row, so `readPixels` returns rows top-first (PNG order)
//   and only the final present to the on-screen canvas flips.
export type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number };

export type Uniforms = Record<string, number | number[] | Float32Array | WebGLTexture | null | boolean>;

type Program = { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null>; samplers: string[]; types: Map<string, number> };

export const FULLSCREEN_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Places a layer-space quad through a pixel-space 4×4 matrix (homogeneous, divided by w). */
export const PLACE_VS = `#version 300 es
in vec2 aPos;
uniform mat4 uMatrix;
uniform vec2 uCanvas;
uniform vec4 uRect; // x, y, w, h of the quad in layer pixels
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vec2 p = uRect.xy + vUv * uRect.zw;
  vec4 q = uMatrix * vec4(p, 0.0, 1.0);
  // pixel homogeneous → NDC; y = 0 (top) maps to NDC −1 so row 0 of the target is the top.
  gl_Position = vec4(q.x * 2.0 / uCanvas.x - q.w, q.y * 2.0 / uCanvas.y - q.w, 0.0, q.w);
}`;

export class GL {
  readonly gl: WebGL2RenderingContext;
  private programs = new Map<string, Program>();
  private quad: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private pool: Target[] = [];
  private live = new Set<Target>();
  readonly maxTexture: number;
  lost = false;

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available on this GPU/driver; motion scenes need it.');
    this.gl = gl;
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const quad = gl.createBuffer();
    const vao = gl.createVertexArray();
    if (!quad || !vao) throw new Error('WebGL2 buffers unavailable');
    this.quad = quad;
    this.vao = vao;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.disable(gl.DEPTH_TEST);
    if ('addEventListener' in canvas) {
      (canvas as HTMLCanvasElement).addEventListener('webglcontextlost', (event) => { event.preventDefault(); this.lost = true; });
    }
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('could not create a shader');
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`motion shader failed to compile: ${log}`);
    }
    return shader;
  }

  program(key: string, fs: string, vs = FULLSCREEN_VS): Program {
    const cached = this.programs.get(key);
    if (cached) return cached;
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) throw new Error('could not create a program');
    gl.attachShader(program, this.compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, this.compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(program, 0, 'aPos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`motion program "${key}" failed to link: ${gl.getProgramInfoLog(program)}`);
    const uniforms = new Map<string, WebGLUniformLocation | null>();
    const types = new Map<string, number>();
    const samplers: string[] = [];
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, '');
      uniforms.set(name, gl.getUniformLocation(program, info.name));
      types.set(name, info.type);
      if (info.type === gl.SAMPLER_2D) samplers.push(name);
    }
    const entry = { program, uniforms, samplers, types };
    this.programs.set(key, entry);
    return entry;
  }

  texture(w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('out of GPU textures');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, Math.max(1, w), Math.max(1, h));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** A transparent render target of at least w × h (exact size). */
  acquire(w: number, h: number): Target {
    const W = Math.max(1, Math.min(this.maxTexture, Math.round(w)));
    const H = Math.max(1, Math.min(this.maxTexture, Math.round(h)));
    const index = this.pool.findIndex((t) => t.w === W && t.h === H);
    let target: Target;
    if (index >= 0) target = this.pool.splice(index, 1)[0];
    else {
      const gl = this.gl;
      const tex = this.texture(W, H);
      const fbo = gl.createFramebuffer();
      if (!fbo) throw new Error('out of GPU framebuffers');
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      target = { tex, fbo, w: W, h: H };
    }
    this.live.add(target);
    this.clear(target);
    return target;
  }

  release(target: Target | null | undefined) {
    if (!target || !this.live.has(target)) return;
    this.live.delete(target);
    this.pool.push(target);
    // Keep the pool bounded; big frames are expensive to hold.
    while (this.pool.length > 48) {
      const old = this.pool.shift()!;
      this.gl.deleteTexture(old.tex);
      this.gl.deleteFramebuffer(old.fbo);
    }
  }

  /** Frees every target not released by the end of a frame (safety net against leaks). */
  releaseAll() {
    for (const target of [...this.live]) this.release(target);
  }

  clear(target: Target | null, rgba: [number, number, number, number] = [0, 0, 0, 0]) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : gl.drawingBufferWidth, target ? target.h : gl.drawingBufferHeight);
    gl.clearColor(rgba[0], rgba[1], rgba[2], rgba[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Uploads an image/canvas/video frame into a (reused) texture; returns the texture. */
  upload(source: TexImageSource, reuse?: WebGLTexture | null): WebGLTexture {
    const gl = this.gl;
    const tex = reuse ?? gl.createTexture();
    if (!tex) throw new Error('out of GPU textures');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  deleteTexture(tex: WebGLTexture | null | undefined) {
    if (tex) this.gl.deleteTexture(tex);
  }

  private setUniforms(p: Program, uniforms: Uniforms) {
    const gl = this.gl;
    let unit = 0;
    for (const [name, value] of Object.entries(uniforms)) {
      const loc = p.uniforms.get(name);
      if (loc === undefined || loc === null) continue;
      const type = p.types.get(name);
      if (type === gl.SAMPLER_2D) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, value as WebGLTexture | null);
        gl.uniform1i(loc, unit);
        unit++;
        continue;
      }
      if (typeof value === 'boolean') { gl.uniform1i(loc, value ? 1 : 0); continue; }
      if (typeof value === 'number') {
        if (type === gl.INT || type === gl.BOOL) gl.uniform1i(loc, Math.round(value));
        else gl.uniform1f(loc, value);
        continue;
      }
      const arr = value instanceof Float32Array ? value : new Float32Array(value as number[]);
      switch (type) {
        case gl.FLOAT_VEC2: gl.uniform2fv(loc, arr); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(loc, arr); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(loc, arr); break;
        case gl.FLOAT_MAT4: gl.uniformMatrix4fv(loc, false, arr); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(loc, false, arr); break;
        default: gl.uniform1fv(loc, arr);
      }
    }
    // Unbound samplers read an empty texture rather than whatever was left bound.
    for (const name of p.samplers) {
      if (!(name in uniforms)) {
        const loc = p.uniforms.get(name);
        if (!loc) continue;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.uniform1i(loc, unit);
        unit++;
      }
    }
  }

  /** Runs a fullscreen fragment pass into `target` (null = the canvas). */
  pass(key: string, fs: string, target: Target | null, uniforms: Uniforms, blend: 'none' | 'over' | 'add' = 'none') {
    const gl = this.gl;
    const p = this.program(key, fs);
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    const w = target ? target.w : gl.drawingBufferWidth;
    const h = target ? target.h : gl.drawingBufferHeight;
    gl.viewport(0, 0, w, h);
    this.applyBlend(blend);
    this.setUniforms(p, { uResolution: [w, h], ...uniforms });
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Draws a layer-space quad through `matrix` into `target`. */
  place(key: string, fs: string, target: Target, uniforms: Uniforms, blend: 'none' | 'over' | 'add' = 'over') {
    const gl = this.gl;
    const p = this.program(key, fs, PLACE_VS);
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    this.applyBlend(blend);
    this.setUniforms(p, { uCanvas: [target.w, target.h], ...uniforms });
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private applyBlend(blend: 'none' | 'over' | 'add') {
    const gl = this.gl;
    if (blend === 'none') { gl.disable(gl.BLEND); return; }
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    if (blend === 'over') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFunc(gl.ONE, gl.ONE);
  }

  /** Reads a target back, rows top-first, premultiplied RGBA. */
  read(target: Target): Uint8Array {
    const gl = this.gl;
    const out = new Uint8Array(target.w * target.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.readPixels(0, 0, target.w, target.h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }

  dispose() {
    for (const target of [...this.pool, ...this.live]) {
      this.gl.deleteTexture(target.tex);
      this.gl.deleteFramebuffer(target.fbo);
    }
    this.pool = [];
    this.live.clear();
    for (const p of this.programs.values()) this.gl.deleteProgram(p.program);
    this.programs.clear();
    this.gl.deleteBuffer(this.quad);
    this.gl.deleteVertexArray(this.vao);
  }
}
