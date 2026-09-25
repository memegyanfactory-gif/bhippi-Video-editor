// `form` layers (docs/REFERENCE-FILMS-PLAN.md P6, C1): soft 2.5D objects — the Motion Tricks look
// that "looks 3D but is 2D". A signed-distance shape (sphere, capsule, cylinder, rounded box,
// torus, coin, slab, prism, cone) is sphere-traced in a fragment shader inside the layer, turned
// by its own 3D orientation, squashed and stretched, shaded with the measured soft-rim formula
// (L = a + b·√(1 − n_z) + c·(n_xy · light)) or another look, and able to morph into another kind
// (a sphere opening into a torus). Instant in preview — Blender is for real glass and meshes.
import { num, vec, type ExprContext } from './anim';
import { parseColor } from './gl/color';
import type { Prop, Vec } from './types';

export const FORM_KINDS = ['sphere', 'capsule', 'cylinder', 'rounded-box', 'torus', 'coin', 'slab', 'prism', 'cone'] as const;
export type FormKind = (typeof FORM_KINDS)[number];
export const FORM_LOOKS = ['soft-rim', 'jelly', 'two-tone', 'glossy', 'glass-fake'] as const;
export type FormLook = (typeof FORM_LOOKS)[number];

export type FormData = {
  kind: FormKind;
  /** Object size in layer px [width, height, depth] (default 300 each; a slab is thin in depth). */
  size?: Prop<Vec>;
  /** The object's own rotation [x, y, z] in degrees (tumble it with keyframes). */
  orientation?: Prop<Vec>;
  look?: FormLook;
  color?: string;
  /** Rim / highlight colour (default a light tint of the colour). */
  rim?: string;
  /** Four colours the surface drifts toward by facing direction (right, left, up, down): the hue field. */
  hue?: [string, string, string, string];
  /** Where the light comes from, in screen terms [x, y] (default top-left [-0.6, -0.8]). */
  light?: Vec;
  /** Corner rounding of boxes, slabs, cylinders and coins, 0–1 of the smallest side (default 0.25). */
  round?: number;
  /** Squash and stretch [sx, sy] (1 = none); volume is kept in depth. */
  squash?: Prop<Vec>;
  /** Morph into another kind as t goes 0 → 1 (a real SDF blend: a sphere opening into a torus). */
  morph?: { to: FormKind; t: Prop<number> };
  /** A surface pattern in object space. */
  pattern?: { kind: 'checker' | 'stripes' | 'dots' | 'band'; color: string; scale?: number };
};

/** The layer's box: room for the object at any orientation. */
export function formBox(data: FormData, t: number): [number, number] {
  const s = vec(data.size, t, [300, 300, 300]);
  // The object's full diagonal (its bounding sphere) fits any orientation; +7% for the perspective.
  const extent = Math.hypot(s[0] ?? 300, s[1] ?? 300, s[2] ?? 300) * 1.07;
  const sq = vec(data.squash, t, [1, 1]);
  return [Math.ceil(extent * Math.max(1, sq[0] ?? 1)), Math.ceil(extent * Math.max(1, sq[1] ?? 1))];
}

/** Rotation X, then Y, then Z (degrees) as a column-major mat3 (object → view). */
export function rotationMatrix(deg: Vec): number[] {
  const [ax, ay, az] = deg.map((d) => ((d ?? 0) * Math.PI) / 180);
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  // R = Rz · Ry · Rx
  const m = [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
  return [m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]];
}

const lighten = (hex: string, k: number) => {
  const c = parseColor(hex);
  return [c[0] + (1 - c[0]) * k, c[1] + (1 - c[1]) * k, c[2] + (1 - c[2]) * k, 1];
};

export function formUniforms(data: FormData, t: number, box: [number, number], ctx?: ExprContext): Record<string, number | number[]> {
  const size = vec(data.size, t, [300, 300, 300], ctx);
  const half = Math.min(box[0], box[1]) / 2;
  const dims = [0, 1, 2].map((i) => Math.max(1, size[i] ?? 300) / 2 / half);
  const hue = data.hue;
  const pattern = data.pattern;
  const kindIndex = (k: FormKind | undefined) => Math.max(0, FORM_KINDS.indexOf(k ?? 'sphere'));
  const light = data.light ?? [-0.6, -0.8];
  const squash = vec(data.squash, t, [1, 1], ctx);
  return {
    uKind: kindIndex(data.kind),
    uKind2: kindIndex(data.morph?.to ?? data.kind),
    uMorph: data.morph ? Math.max(0, Math.min(1, num(data.morph.t, t, 0, ctx))) : 0,
    uDims: dims,
    uRot: rotationMatrix(vec(data.orientation, t, [0, 0, 0], ctx)),
    uLook: Math.max(0, FORM_LOOKS.indexOf(data.look ?? 'soft-rim')),
    uBase: parseColor(data.color ?? '#7b61ff'),
    uRim: data.rim ? parseColor(data.rim) : lighten(data.color ?? '#7b61ff', 0.65),
    uH1: hue ? parseColor(hue[0]) : [0, 0, 0, 0],
    uH2: hue ? parseColor(hue[1]) : [0, 0, 0, 0],
    uH3: hue ? parseColor(hue[2]) : [0, 0, 0, 0],
    uH4: hue ? parseColor(hue[3]) : [0, 0, 0, 0],
    uLight: [light[0] ?? -0.6, light[1] ?? -0.8],
    uRound: Math.max(0, Math.min(1, data.round ?? 0.25)),
    uSquash: [Math.max(0.05, squash[0] ?? 1), Math.max(0.05, squash[1] ?? 1)],
    uPattern: [pattern ? ['checker', 'stripes', 'dots', 'band'].indexOf(pattern.kind) + 1 : 0, pattern?.scale ?? 4, 0, 0],
    uPatColor: pattern ? parseColor(pattern.color) : [0, 0, 0, 0],
  };
}
