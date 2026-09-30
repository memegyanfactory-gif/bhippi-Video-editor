// The effect stack: each effect is a pass (or a few) over a layer-space texture. Params arrive
// resolved (evaluate.ts) in layer pixels; `density` converts them to texture pixels.
import type { ResolvedEffect } from '../evaluate';
import { parseColor } from './color';
import type { GL, Target } from './core';
import * as S from './shaders';

export type EffectEnv = {
  density: number;
  /** Scene seconds (for animated noise and matte FX timing). */
  time: number;
  fps: number;
  seed: number;
  /** Layer-space subject matte (white alpha), aligned with the content, when the layer has one. */
  matte?: Target | null;
  /** The uncut footage, aligned with the content (matte FX draw from it). */
  footage?: Target | null;
  /** Layer pixel size and padding of the content texture. */
  size: [number, number];
  pad: number;
};

const n = (params: Record<string, unknown>, key: string, fallback: number): number => {
  const v = params[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (Array.isArray(v) && typeof v[0] === 'number') return v[0];
  return fallback;
};
const v2 = (params: Record<string, unknown>, key: string, fallback: [number, number]): [number, number] => {
  const v = params[key];
  return Array.isArray(v) && v.length >= 2 ? [Number(v[0]), Number(v[1])] : fallback;
};
const s = (params: Record<string, unknown>, key: string, fallback: string): string => (typeof params[key] === 'string' ? (params[key] as string) : fallback);
const b = (params: Record<string, unknown>, key: string, fallback: boolean): boolean => (typeof params[key] === 'boolean' ? (params[key] as boolean) : typeof params[key] === 'number' ? (params[key] as number) > 0 : fallback);
const rgb = (color: string) => parseColor(color).slice(0, 3);

/** Extra layer pixels an effect draws outside the content (so the target is grown first). */
export function effectPad(effect: ResolvedEffect): number {
  const p = effect.params;
  switch (effect.type) {
    case 'glow': return n(p, 'radius', 30) * 3;
    case 'halation': return n(p, 'radius', 40) * 2.5;
    case 'drop-shadow': return n(p, 'distance', 12) + n(p, 'softness', 20) * 2 + 4;
    case 'stroke': return n(p, 'width', 4) + 2;
    case 'gaussian-blur': case 'lens-blur': return n(p, 'blurriness', n(p, 'radius', 10)) * 1.5;
    case 'directional-blur': return n(p, 'length', 20) / 2 + 2;
    case 'matte-edge-glow': return n(p, 'radius', 20) * 2;
    case 'subject-reveal': return n(p, 'glowRadius', 26) * 2;
    default: return 0;
  }
}

/** Gaussian blur with downsampling for big radii; `sigma` in texture pixels. Returns a new target. */
export function blur(gl: GL, src: Target, sigma: number): Target {
  if (sigma < 0.3) {
    const copy = gl.acquire(src.w, src.h);
    gl.pass('copy', S.COPY_FS, copy, { uTex: src.tex, uOpacity: 1 });
    return copy;
  }
  let factor = 1;
  while (sigma / factor > 6 && factor < 16 && src.w / (factor * 2) >= 4 && src.h / (factor * 2) >= 4) factor *= 2;
  // Successive halving keeps the downscale from aliasing.
  let current = src;
  const temps: Target[] = [];
  for (let f = 2; f <= factor; f *= 2) {
    const next = gl.acquire(Math.max(1, Math.round(src.w / f)), Math.max(1, Math.round(src.h / f)));
    gl.pass('copy', S.COPY_FS, next, { uTex: current.tex, uOpacity: 1 });
    temps.push(next);
    current = next;
  }
  const small = sigma / factor;
  const h = gl.acquire(current.w, current.h);
  gl.pass('blur', S.BLUR_FS, h, { uTex: current.tex, uDir: [1, 0], uSigma: small });
  const v = gl.acquire(current.w, current.h);
  gl.pass('blur', S.BLUR_FS, v, { uTex: h.tex, uDir: [0, 1], uSigma: small });
  gl.release(h);
  for (const t of temps) gl.release(t);
  if (factor === 1) return v;
  const out = gl.acquire(src.w, src.h);
  gl.pass('copy', S.COPY_FS, out, { uTex: v.tex, uOpacity: 1 });
  gl.release(v);
  return out;
}

function colorOp(gl: GL, src: Target, op: number, a: number[] = [0, 0, 0, 0], bb: number[] = [0, 0, 0, 0], c: number[] = [0, 0, 0, 0]): Target {
  const out = gl.acquire(src.w, src.h);
  gl.pass('color', S.COLOR_FS, out, { uTex: src.tex, uOp: op, uA: a, uB: bb, uC: c });
  return out;
}

function distort(gl: GL, src: Target, op: number, a: number[], time: number, bb: number[] = [0, 0, 0, 0]): Target {
  const out = gl.acquire(src.w, src.h);
  gl.pass('distort', S.DISTORT_FS, out, { uTex: src.tex, uOp: op, uA: a, uB: bb, uTime: time });
  return out;
}

/** `satWeight` 0–1: how far white and grey are kept out of the bloom (1 = only colour glows; the finish presets' bloom). */
function glow(gl: GL, src: Target, radius: number, intensity: number, threshold: number, tint: string | null, deep: boolean, screen: boolean, satWeight = 0, knee = 0.1): Target {
  const bright = gl.acquire(src.w, src.h);
  gl.pass('threshold', S.THRESHOLD_FS, bright, { uTex: src.tex, uThreshold: threshold, uKnee: knee, uTint: tint ? rgb(tint) : [1, 1, 1], uUseTint: tint ? 1 : 0, uSatWeight: Math.min(1, Math.max(0, satWeight)) });
  const g1 = blur(gl, bright, radius * 0.5);
  const g2 = deep ? blur(gl, bright, radius * 1.2) : null;
  const g3 = deep ? blur(gl, bright, radius * 2.8) : null;
  gl.release(bright);
  const out = gl.acquire(src.w, src.h);
  gl.pass('glow-combine', S.GLOW_COMBINE_FS, out, { uTex: src.tex, uG1: g1.tex, uG2: (g2 ?? g1).tex, uG3: (g3 ?? g1).tex, uWeights: deep ? [0.55, 0.35, 0.25] : [1, 0, 0], uIntensity: intensity, uScreen: screen ? 1 : 0 });
  gl.release(g1);
  gl.release(g2);
  gl.release(g3);
  return out;
}

/** Applies one effect; returns a new target (the caller releases the input). */
export function applyEffect(gl: GL, src: Target, effect: ResolvedEffect, env: EffectEnv): Target {
  const p = effect.params;
  const d = env.density;
  switch (effect.type) {
    case 'gaussian-blur':
    case 'lens-blur':
      return blur(gl, src, n(p, 'blurriness', n(p, 'radius', 10)) * 0.5 * d);
    case 'directional-blur': {
      const angle = (n(p, 'direction', 0) * Math.PI) / 180;
      const length = n(p, 'length', 20) * d;
      const out = gl.acquire(src.w, src.h);
      gl.pass('dirblur', S.DIRECTIONAL_BLUR_FS, out, { uTex: src.tex, uVector: [Math.sin(angle) * length, -Math.cos(angle) * length] });
      return out;
    }
    case 'zoom-blur': {
      const c = v2(p, 'center', [0.5, 0.5]);
      const center = c[0] > 1 || c[1] > 1 ? [(c[0] + env.pad) / (env.size[0] + env.pad * 2), (c[1] + env.pad) / (env.size[1] + env.pad * 2)] : c;
      const out = gl.acquire(src.w, src.h);
      gl.pass('zoomblur', S.ZOOM_BLUR_FS, out, { uTex: src.tex, uCenter: center, uAmount: Math.min(0.95, Math.max(0, n(p, 'amount', 0.25))) });
      return out;
    }
    case 'glow':
      return glow(gl, src, n(p, 'radius', 30) * d, n(p, 'intensity', 1), n(p, 'threshold', 0), typeof p.color === 'string' ? (p.color as string) : null, b(p, 'deep', true), b(p, 'screen', false), n(p, 'saturationWeight', 0), n(p, 'knee', 0.1));
    case 'halation':
      return glow(gl, src, n(p, 'radius', 40) * d, n(p, 'intensity', 0.6), n(p, 'threshold', 0.7), s(p, 'color', '#ff4a1f'), true, true);
    case 'drop-shadow': {
      const distance = n(p, 'distance', 12) * d;
      const angle = (n(p, 'direction', 135) * Math.PI) / 180;
      const blurred = blur(gl, src, n(p, 'softness', 20) * 0.5 * d);
      const out = gl.acquire(src.w, src.h);
      const color = parseColor(s(p, 'color', '#000000'));
      gl.pass('shadow', S.SHADOW_FS, out, { uTex: src.tex, uBlurred: blurred.tex, uOffset: [Math.sin(angle) * distance, -Math.cos(angle) * distance], uColor: [color[0], color[1], color[2], n(p, 'opacity', 60) / 100], uOnly: b(p, 'shadowOnly', false) ? 1 : 0 });
      gl.release(blurred);
      return out;
    }
    case 'stroke': {
      const out = gl.acquire(src.w, src.h);
      const color = parseColor(s(p, 'color', '#ffffff'));
      const position = s(p, 'position', 'outside');
      gl.pass('stroke', S.STROKE_FS, out, { uTex: src.tex, uWidth: n(p, 'width', 4) * d, uColor: [color[0], color[1], color[2], n(p, 'opacity', 100) / 100], uPosition: position === 'outside' ? 0 : position === 'center' ? 1 : 2 });
      return out;
    }
    case 'tint': return colorOp(gl, src, 0, [...rgb(s(p, 'black', '#000000')), 0], [...rgb(s(p, 'white', '#ffffff')), 0], [n(p, 'amount', 100) / 100, 0, 0, 0]);
    case 'duotone': return colorOp(gl, src, 1, [...rgb(s(p, 'shadows', '#12030a')), 0], [...rgb(s(p, 'highlights', '#ff5a6e')), 0], [n(p, 'amount', 100) / 100, n(p, 'contrast', 1.15), 0, 0]);
    case 'black-white': return colorOp(gl, src, 2, [...rgb(s(p, 'filter', '#ffffff')), 0], [0, 0, 0, 0], [n(p, 'amount', 100) / 100, 0, 0, 0]);
    case 'brightness-contrast': return colorOp(gl, src, 3, [n(p, 'brightness', 0) / 100, n(p, 'contrast', 0) / 100, 0, 0]);
    case 'hue-saturation': return colorOp(gl, src, 4, [n(p, 'hue', 0) / 360, 1 + n(p, 'saturation', 0) / 100, n(p, 'lightness', 0) / 100, 0]);
    case 'levels': return colorOp(gl, src, 5, [n(p, 'inBlack', 0) / 255, n(p, 'inWhite', 255) / 255, n(p, 'gamma', 1), 0], [n(p, 'outBlack', 0) / 255, n(p, 'outWhite', 255) / 255, 0, 0]);
    case 'exposure': return colorOp(gl, src, 6, [n(p, 'exposure', 0), n(p, 'offset', 0), n(p, 'gamma', 1), 0], [b(p, 'linear', false) ? 1 : 0, n(p, 'knee', 0), n(p, 'ceiling', 0), 0]);
    case 'invert': return colorOp(gl, src, 7, [0, 0, 0, 0], [0, 0, 0, 0], [n(p, 'amount', 100) / 100, 0, 0, 0]);
    case 'fill': return colorOp(gl, src, 8, [...rgb(s(p, 'color', '#ffffff')), 0], [0, 0, 0, 0], [n(p, 'amount', 100) / 100, 0, 0, 0]);
    case 'vignette': return colorOp(gl, src, 9, [n(p, 'amount', 0.45), n(p, 'size', 1.05), n(p, 'softness', 0.75), n(p, 'roundness', 0)]);
    case 'riso':
    case 'halftone': {
      // Print the layer as riso inks (colour separated per pixel) or a one-ink halftone.
      const inks = (Array.isArray(p.inks) && p.inks.length ? (p.inks as string[]) : effect.type === 'halftone' ? [s(p, 'color', '#1d1b22')] : ['#2f6fb0', '#ff48b0', '#ffe800']).slice(0, 4);
      const col = (i: number) => rgb(inks[Math.min(i, inks.length - 1)]);
      const paper = typeof p.paper === 'string' ? [...rgb(p.paper as string), 1] : [1, 1, 1, 0];
      const mis = n(p, 'misregister', effect.type === 'halftone' ? 0 : 3);
      const frame = Math.floor(env.time * env.fps / Math.max(1, n(p, 'step', 2)));
      const jitter = (k: number) => (((Math.sin(frame * 12.9898 + k * 78.233) * 43758.5453) % 1) - 0.5) * 2 * n(p, 'tremor', 0.6);
      const off = [0, 0, Math.cos(2.1) * mis + jitter(1), Math.sin(2.1) * mis + jitter(2), Math.cos(4.2) * mis + jitter(3), Math.sin(4.2) * mis + jitter(4), Math.cos(6.3) * mis + jitter(5), Math.sin(6.3) * mis + jitter(6)];
      const angle = n(p, 'angle', 15);
      const out = gl.acquire(src.w, src.h);
      gl.pass('riso-fx', S.RISO_EFFECT_FS, out, {
        uTex: src.tex, uInk0: col(0), uInk1: col(1), uInk2: col(2), uInk3: col(3), uCount: inks.length, uPaper: paper,
        uPitch: n(p, 'pitch', 5) * d, uDensity: d, uSeed: env.seed % 997, uAngles: [angle, angle + 60, angle - 15, angle + 30].map((a) => (a * Math.PI) / 180),
        uOffA: off.slice(0, 4), uOffB: off.slice(4, 8), uMode: effect.type === 'halftone' ? 1 : 0, uAmount: n(p, 'amount', 100) / 100,
      });
      return out;
    }
    case 'grain': return colorOp(gl, src, 10, [n(p, 'amount', 0.35) * 0.25, n(p, 'size', 1.2) * d, b(p, 'animated', true) ? Math.floor(env.time * env.fps) % 997 : env.seed, 0]);
    case 'radial-gradient-overlay': {
      const c = v2(p, 'center', [0.5, 0.5]);
      return colorOp(gl, src, 11, [c[0], c[1], n(p, 'radius', 0.7), 0], [...rgb(s(p, 'color', '#c2182f')), 0], [n(p, 'amount', 50) / 100, b(p, 'screen', true) ? 1 : 0, 0, 0]);
    }
    case 'chromatic-aberration': {
      const c = v2(p, 'center', [0.5, 0.5]);
      return distort(gl, src, 0, [n(p, 'amount', 8) * d, c[0], c[1], 0], env.time);
    }
    case 'rgb-split': return distort(gl, src, 1, [n(p, 'x', 6) * d, n(p, 'y', 0) * d, 0, 0], env.time);
    case 'mosaic': {
      const cell = n(p, 'cell', 24) * d;
      return distort(gl, src, 2, [cell, n(p, 'cellY', n(p, 'cell', 24)) * d, 0, 0], env.time);
    }
    case 'turbulent-displace': return distort(gl, src, 3, [n(p, 'amount', 20) * d, n(p, 'size', 80) * d, n(p, 'speed', 0.6), 0], env.time);
    case 'wave-warp': return distort(gl, src, 4, [n(p, 'amplitude', 10) * d, n(p, 'wavelength', 120) * d, n(p, 'speed', 1), n(p, 'direction', 0)], env.time);
    case 'lens-distortion': return distort(gl, src, 5, [n(p, 'amount', 0.2), n(p, 'zoom', 1), 0, 0], env.time);
    case 'pixel-sort': return distort(gl, src, 6, [n(p, 'low', 0.25), n(p, 'high', 0.95), n(p, 'length', 180) * d, n(p, 'angle', 90)], env.time, [n(p, 'amount', 1), 0, 0, 0]);
    case 'displacement': return distort(gl, src, 7, [n(p, 'amount', 12) * d, n(p, 'scale', 120) * d, n(p, 'speed', 0.3), 0], env.time);
    case 'matte-choke': {
      const lo = n(p, 'low', 0.1);
      const hi = n(p, 'high', 0.9);
      return chokeAlpha(gl, src, lo, hi);
    }
    case 'light-leak': {
      const leak = gl.acquire(src.w, src.h);
      const colors = [parseColor(s(p, 'color1', '#ff6a2a')), parseColor(s(p, 'color2', '#ff2a5a')), parseColor(s(p, 'color3', '#ffd28a'))];
      gl.pass('procedural', S.PROCEDURAL_FS, leak, { uKind: 7, uTime: env.time, uC1: colors[0], uC2: colors[1], uC3: colors[2], uP: [n(p, 'speed', 0.4), n(p, 'intensity', 0.8), 0, 0], uQ: [0, 0, 0, 0] });
      const out = gl.acquire(src.w, src.h);
      gl.pass('blend', S.BLEND_FS, out, { uDst: src.tex, uSrc: leak.tex, uMode: 2 });
      gl.release(leak);
      return out;
    }
    case 'liquid-glass': {
      const height = blur(gl, src, n(p, 'bevel', 18) * d);
      const out = gl.acquire(src.w, src.h);
      const light = v2(p, 'light', [-0.5, -0.7]);
      gl.pass('liquid', S.LIQUID_GLASS_FS, out, { uTex: src.tex, uHeight: height.tex, uBackdrop: src.tex, uRefraction: n(p, 'refraction', 24) * d, uSpecular: n(p, 'specular', 0.8), uTintAmount: n(p, 'tintAmount', 0.1), uTint: rgb(s(p, 'tint', '#ffffff')), uLight: light });
      gl.release(height);
      return out;
    }
    case 'inner-shadow':
    case 'inner-glow': {
      const shadow = effect.type === 'inner-shadow';
      const size = n(p, 'size', shadow ? 12 : 18) * d;
      const blurred = blur(gl, src, size * 0.5);
      const angle = (n(p, 'direction', 135) * Math.PI) / 180;
      const distance = shadow ? n(p, 'distance', 8) * d : 0;
      const color = parseColor(s(p, 'color', shadow ? '#000000' : '#ffffff'));
      const out = gl.acquire(src.w, src.h);
      gl.pass('inner', S.INNER_FS, out, { uTex: src.tex, uBlurred: blurred.tex, uOffset: [Math.sin(angle) * distance, -Math.cos(angle) * distance], uColor: [color[0], color[1], color[2], n(p, 'opacity', shadow ? 55 : 70) / 100], uChoke: Math.min(0.95, Math.max(0, n(p, 'choke', 0) / 100)), uBlend: shadow ? 0 : 1 });
      gl.release(blurred);
      return out;
    }
    case 'bevel': {
      const height = blur(gl, src, n(p, 'size', 16) * 0.5 * d);
      const angle = (n(p, 'angle', 120) * Math.PI) / 180;
      const altitude = (n(p, 'altitude', 35) * Math.PI) / 180;
      // AE convention: the angle is where the light comes FROM (120° = upper left).
      const light = [-Math.cos(angle) * Math.cos(altitude), -Math.sin(angle) * Math.cos(altitude), Math.sin(altitude)];
      const hi = parseColor(s(p, 'highlight', '#ffffff'));
      const sh = parseColor(s(p, 'shadow', '#000000'));
      const out = gl.acquire(src.w, src.h);
      gl.pass('bevel', S.BEVEL_FS, out, { uTex: src.tex, uHeight: height.tex, uLight: light, uDepth: n(p, 'depth', 100) / 100 * Math.max(1, n(p, 'size', 16) * d), uHighlight: [hi[0], hi[1], hi[2], n(p, 'highlightOpacity', 75) / 100], uShadow: [sh[0], sh[1], sh[2], n(p, 'shadowOpacity', 45) / 100] });
      gl.release(height);
      return out;
    }
    case 'gradient-overlay': {
      const raw = Array.isArray(p.stops) ? (p.stops as [number, string][]) : [[0, s(p, 'from', '#8b6cf0')], [1, s(p, 'to', '#3a7bff')]] as [number, string][];
      const stops = raw.slice(0, 4).map(([at, color]) => [...rgb(color), at]);
      while (stops.length < 4) stops.push(stops[stops.length - 1]);
      const angle = (n(p, 'angle', 90) * Math.PI) / 180;
      const blendIndex = ['normal', 'soft-light', 'multiply', 'screen'].indexOf(s(p, 'blend', 'normal'));
      const out = gl.acquire(src.w, src.h);
      gl.pass('gradient-overlay', S.GRADIENT_OVERLAY_FS, out, { uTex: src.tex, uDir: [Math.cos(angle), Math.sin(angle)], uOffset: n(p, 'offset', 0), uScale: Math.max(0.01, n(p, 'scale', 100) / 100), uC0: stops[0], uC1: stops[1], uC2: stops[2], uC3: stops[3], uCount: Math.min(4, raw.length), uOpacity: n(p, 'opacity', 100) / 100, uBlend: Math.max(0, blendIndex), uRepeat: b(p, 'repeat', false) ? 1 : 0 });
      return out;
    }
    case 'subject-reveal': return subjectReveal(gl, src, p, env);
    case 'matte-fill': {
      if (!env.matte && !b(p, 'useAlpha', true)) return copyOf(gl, src);
      const out = gl.acquire(src.w, src.h);
      const from = s(p, 'from', 'bottom');
      gl.pass('mattefill', S.MATTE_FILL_FS, out, {
        uTex: (env.footage ?? src).tex,
        uMatte: env.matte ? env.matte.tex : src.tex,
        uUseMatte: env.matte ? 1 : 0,
        uProgress: n(p, 'progress', 1),
        uMix: n(p, 'mix', 0),
        uSoft: n(p, 'softness', 0.08),
        uFrom: ['bottom', 'top', 'left', 'right', 'center'].indexOf(from) < 0 ? 0 : ['bottom', 'top', 'left', 'right', 'center'].indexOf(from),
        uFill: rgb(s(p, 'fill', '#e0112b')),
        uFill2: rgb(s(p, 'fill2', s(p, 'fill', '#ff8a1f'))),
      });
      return out;
    }
    case 'matte-edge-glow': {
      const blurred = blur(gl, src, n(p, 'radius', 20) * 0.5 * d);
      const out = gl.acquire(src.w, src.h);
      const color = parseColor(s(p, 'color', '#ff3048'));
      gl.pass('edge', S.EDGE_FS, out, { uTex: src.tex, uBlurred: blurred.tex, uColor: color, uIntensity: n(p, 'intensity', 1.2) });
      gl.release(blurred);
      return out;
    }
    default:
      return copyOf(gl, src);
  }
}

function copyOf(gl: GL, src: Target): Target {
  const out = gl.acquire(src.w, src.h);
  gl.pass('copy', S.COPY_FS, out, { uTex: src.tex, uOpacity: 1 });
  return out;
}

const CHOKE_FS = `${S.HEAD}
uniform sampler2D uTex;
uniform float uLo;
uniform float uHi;
void main() {
  vec4 c = texture(uTex, vUv);
  float a = smoothstep(uLo, uHi, c.a);
  outColor = vec4(unpremul(c) * a, a);
}`;

function chokeAlpha(gl: GL, src: Target, lo: number, hi: number): Target {
  const out = gl.acquire(src.w, src.h);
  gl.pass('choke', CHOKE_FS, out, { uTex: src.tex, uLo: lo, uHi: Math.max(lo + 1e-3, hi) });
  return out;
}

/**
 * The reference opening's reveal. Params (all optional):
 *   at (scene s, when the seed appears) · seed [x, y] layer px (default: upper-centre of the
 *   subject) · cell px (32 @1080p) · radial / vertical / noise (seconds per frame-diagonal) ·
 *   speed (× all delays) · fill colour · fillStrength 0..1 · decay s · resolveStart/resolveEnd
 *   (cell age, s) · spill 0..1 · glowRadius px · glowIntensity · reverse (dissolve out).
 */
function subjectReveal(gl: GL, src: Target, p: Record<string, unknown>, env: EffectEnv): Target {
  const d = env.density;
  // Without a roto matte the layer's own alpha is the subject (a cut-out PNG, a precomp).
  const derived = env.matte ? null : alphaAsMatte(gl, src);
  const matte = env.matte ?? derived!;
  const footage = env.footage ?? src;
  const scaleRef = (env.size[1] || 1080) / 1080;
  const seed = v2(p, 'seed', [env.size[0] / 2, env.size[1] * 0.3]);
  const speed = Math.max(0.05, n(p, 'speed', 1));
  const uniforms = {
    uTex: footage.tex,
    uMatte: matte.tex,
    uTime: env.time - n(p, 'at', 0),
    uSeed: [(seed[0] + env.pad) * d, (seed[1] + env.pad) * d],
    uCell: Math.max(2, n(p, 'cell', 32 * scaleRef) * d),
    uKr: n(p, 'radial', 0.85) * speed,
    uKy: n(p, 'vertical', 0.7) * speed,
    uKn: n(p, 'noise', 0.05) * speed,
    uThreshold: n(p, 'threshold', 0.35),
    uSpill: n(p, 'spill', 0.35),
    uFill: rgb(s(p, 'fill', '#ff1f3d')),
    uFillStrength: n(p, 'fillStrength', 0.85),
    uDecay: n(p, 'decay', 0.14) * speed,
    uResolveStart: n(p, 'resolveStart', 0.1) * speed,
    uResolveEnd: n(p, 'resolveEnd', 0.32) * speed,
    uReverse: b(p, 'reverse', false) ? 1 : 0,
    uHotOnly: 0,
  };
  // When the matte comes from the alpha of `src` (no separate matte), the shader reads .r of a
  // white-alpha target, which equals alpha for our premultiplied white matte targets.
  const main = gl.acquire(src.w, src.h);
  gl.pass('reveal', S.SUBJECT_REVEAL_FS, main, uniforms);
  const glowIntensity = n(p, 'glowIntensity', 1.1);
  if (glowIntensity <= 0) { gl.release(derived); return main; }
  const hot = gl.acquire(src.w, src.h);
  gl.pass('reveal', S.SUBJECT_REVEAL_FS, hot, { ...uniforms, uHotOnly: 1 });
  const bloom = blur(gl, hot, n(p, 'glowRadius', 26) * 0.5 * d);
  gl.release(hot);
  const out = gl.acquire(src.w, src.h);
  gl.pass('glow-combine', S.GLOW_COMBINE_FS, out, { uTex: main.tex, uG1: bloom.tex, uG2: bloom.tex, uG3: bloom.tex, uWeights: [1, 0, 0], uIntensity: glowIntensity, uScreen: 0 });
  gl.release(bloom);
  gl.release(main);
  gl.release(derived);
  return out;
}

const ALPHA_MATTE_FS = `${S.HEAD}
uniform sampler2D uTex;
void main() { outColor = vec4(texture(uTex, vUv).a); }`;

function alphaAsMatte(gl: GL, src: Target): Target {
  const out = gl.acquire(src.w, src.h);
  gl.pass('alpha-matte', ALPHA_MATTE_FS, out, { uTex: src.tex });
  return out;
}

/** Runs a whole stack; releases intermediates. */
export function applyEffects(gl: GL, src: Target, effects: ResolvedEffect[], env: EffectEnv): Target {
  let current = src;
  for (const effect of effects) {
    const next = applyEffect(gl, current, effect, env);
    if (current !== src) gl.release(current);
    current = next;
  }
  return current;
}
