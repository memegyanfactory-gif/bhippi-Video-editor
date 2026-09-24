// Friendly parameters of procedural backgrounds → PROCEDURAL_FS uniforms.
import type { ProceduralKind } from '../types';
import { parseColor } from './color';
import type { Uniforms } from './core';

const KINDS: ProceduralKind[] = ['crimson-stage', 'radial-glow', 'linear-gradient', 'hex-field', 'grid', 'light-rails', 'noise', 'light-leak', 'dots', 'aurora', 'mesh-gradient', 'light-shafts', 'dot-wave'];

const num = (params: Record<string, unknown>, key: string, fallback: number) => (typeof params[key] === 'number' ? (params[key] as number) : fallback);
const col = (params: Record<string, unknown>, key: string, fallback: string) => parseColor(typeof params[key] === 'string' ? (params[key] as string) : fallback);
const vec = (params: Record<string, unknown>, key: string, fallback: number[]) => (Array.isArray(params[key]) ? (params[key] as number[]) : fallback);

/** The id (centre, in hex-grid units) of the hex cell containing layer pixel `p` for cell size `size`. */
export function hexCellAt(p: number[], size: number): [number, number] {
  const q = [p[0] / size, p[1] / size];
  const r = [1, 1.7320508];
  const h = [0.5, 0.8660254];
  const mod = (a: number, m: number) => a - m * Math.floor(a / m);
  const a = [mod(q[0], r[0]) - h[0], mod(q[1], r[1]) - h[1]];
  const b = [mod(q[0] - h[0], r[0]) - h[0], mod(q[1] - h[1], r[1]) - h[1]];
  const gv = a[0] * a[0] + a[1] * a[1] < b[0] * b[0] + b[1] * b[1] ? a : b;
  return [q[0] - gv[0], q[1] - gv[1]];
}

export function proceduralUniforms(kind: ProceduralKind, params: Record<string, unknown>, time: number, size: [number, number]): Uniforms {
  const base: Uniforms = { uKind: Math.max(0, KINDS.indexOf(kind)), uTime: time, uC1: [0, 0, 0, 1], uC2: [0, 0, 0, 1], uC3: [0, 0, 0, 1], uP: [0, 0, 0, 0], uQ: [0, 0, 0, 0], uSize: size };
  switch (kind) {
    case 'crimson-stage':
      return { ...base, uC1: col(params, 'top', '#0d0204'), uC2: col(params, 'glow', '#a3102a'), uC3: col(params, 'hot', '#ff4a64'), uP: [num(params, 'glowY', 1.08), num(params, 'spread', 0.32), num(params, 'intensity', 1), 0] };
    case 'radial-glow': {
      const c = vec(params, 'center', [0.5, 0.5]);
      return { ...base, uC1: col(params, 'inner', '#6b0a1b'), uC2: col(params, 'outer', '#0a0204'), uP: [c[0], c[1], num(params, 'radius', 0.9), 0] };
    }
    case 'linear-gradient': {
      const via = typeof params.via === 'string';
      return { ...base, uC1: col(params, 'from', '#0d0204'), uC2: col(params, via ? 'via' : 'to', '#a3102a'), uC3: col(params, 'to', '#a3102a'), uP: [num(params, 'angle', 90), via ? 1 : 0, 0, 0] };
    }
    case 'hex-field': {
      const cell = num(params, 'size', 120);
      const at = params.highlightAt ? hexCellAt(vec(params, 'highlightAt', [0, 0]), cell) : [-999, -999];
      return { ...base, uC1: col(params, 'base', '#12020a'), uC2: col(params, 'face', '#b0142f'), uC3: col(params, 'highlight', '#ff5a70'), uP: [cell, num(params, 'gap', 0.035), num(params, 'bevel', 0.09), 0], uQ: [at[0], at[1], num(params, 'highlightAmount', 0.8), 0] };
    }
    case 'grid':
      return { ...base, uC1: col(params, 'bg', '#0a0204'), uC2: col(params, 'color', '#ff4a6433'), uP: [num(params, 'spacing', 80), num(params, 'line', 1.5), num(params, 'fade', 1), 0] };
    case 'light-rails':
      return { ...base, uC1: col(params, 'bg', '#0d0204'), uC2: col(params, 'color', '#ff8a9a'), uP: [num(params, 'count', 5), num(params, 'floorY', 0.82), num(params, 'progress', 1), 0] };
    case 'noise':
      return { ...base, uC1: col(params, 'from', '#0d0204'), uC2: col(params, 'to', '#3a0710'), uP: [num(params, 'scale', 240), num(params, 'speed', 0.08), 0, 0] };
    case 'light-leak':
      return { ...base, uC1: col(params, 'color1', '#ff6a2a'), uC2: col(params, 'color2', '#ff2a5a'), uC3: col(params, 'color3', '#ffd28a'), uP: [num(params, 'speed', 0.4), num(params, 'intensity', 0.9), 0, 0] };
    case 'dots':
      return { ...base, uC1: col(params, 'bg', '#0a0204'), uC2: col(params, 'color', '#ff4a6455'), uP: [num(params, 'spacing', 36), num(params, 'radius', 2), 0, 0] };
    case 'aurora':
      return { ...base, uC1: col(params, 'bg', '#050108'), uC2: col(params, 'a', '#c2182f'), uC3: col(params, 'b', '#ff7a3d'), uP: [num(params, 'speed', 0.15), 0, 0, 0] };
    case 'mesh-gradient': {
      const c4 = col(params, 'd', '#ffd6e8');
      return { ...base, uC1: col(params, 'a', '#c7d2fe'), uC2: col(params, 'b', '#fbcfe8'), uC3: col(params, 'c', '#a5f3fc'), uQ: [c4[0], c4[1], c4[2], 1], uP: [num(params, 'speed', 0.25), num(params, 'softness', 0.18), 0, 0] };
    }
    case 'light-shafts': {
      const o = vec(params, 'origin', [0.5, -0.1]);
      return { ...base, uC1: col(params, 'bg', '#00000000'), uC2: col(params, 'color', '#ffffff'), uP: [o[0], o[1], num(params, 'count', 9), num(params, 'intensity', 0.55)], uQ: [num(params, 'reach', 0.9), num(params, 'speed', 0.25), 0, 0] };
    }
    case 'dot-wave':
      return { ...base, uC1: col(params, 'bg', '#05060c'), uC2: col(params, 'color', '#7b8cff'), uP: [num(params, 'spacing', 26), num(params, 'amplitude', 26), num(params, 'speed', 0.8), num(params, 'radius', 3)], uQ: [num(params, 'frequency', 1.2), 0, 0, 0] };
    default:
      return base;
  }
}
