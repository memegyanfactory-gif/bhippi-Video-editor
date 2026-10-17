import { LOBES, seeded, type Lobe3D } from './kinds';

/*
 * The brain's body as a signed-distance field (negative inside), in a frame where y is up, +z is the
 * front and x runs across. It is a handful of blended ellipsoids: two hemispheres cut by a longitudinal
 * fissure, frontal / occipital / temporal bulges, a cerebellum with fine folia, and a brainstem. Gyri and
 * sulci are carved with 3D noise. The cortex particle cloud is sampled straight from this field.
 */

const hash = (x: number, y: number, z: number) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Smooth value noise in -1..1. */
const noise = (x: number, y: number, z: number) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fy = y - iy;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iy, iz);
  const b = hash(ix + 1, iy, iz);
  const c = hash(ix, iy + 1, iz);
  const d = hash(ix + 1, iy + 1, iz);
  const e = hash(ix, iy, iz + 1);
  const f = hash(ix + 1, iy, iz + 1);
  const g = hash(ix, iy + 1, iz + 1);
  const h = hash(ix + 1, iy + 1, iz + 1);
  const x1 = a + (b - a) * fx;
  const x2 = c + (d - c) * fx;
  const x3 = e + (f - e) * fx;
  const x4 = g + (h - g) * fx;
  const y1 = x1 + (x2 - x1) * fy;
  const y2 = x3 + (x4 - x3) * fy;
  return (y1 + (y2 - y1) * fz) * 2 - 1;
};

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const ell = (x: number, y: number, z: number, a: number, b: number, c: number) => (Math.sqrt((x * x) / (a * a) + (y * y) / (b * b) + (z * z) / (c * c)) - 1) * Math.min(a, b, c);
const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Distance to the brainstem: a tilted capsule that tapers downward. */
const stem = (x: number, y: number, z: number) => {
  const ax = 0; const ay = -0.34; const az = -0.2;
  const bx = 0; const by = -0.98; const bz = -0.4;
  const px = x - ax; const py = y - ay; const pz = z - az;
  const dx = bx - ax; const dy = by - ay; const dz = bz - az;
  const t = Math.min(1, Math.max(0, (px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz)));
  const qx = px - dx * t; const qy = py - dy * t; const qz = pz - dz * t;
  return Math.sqrt(qx * qx + qy * qy + qz * qz) - (0.105 - 0.03 * t);
};

/** The smooth bulk of the brain, no folds. */
export function bulk(x: number, y: number, z: number) {
  const ax = Math.abs(x);
  const main = ell(ax - 0.3, y - 0.05, z + 0.02, 0.44, 0.45, 0.88);
  const front = ell(ax - 0.16, y - 0.0, z - 0.56, 0.3, 0.36, 0.36);
  const back = ell(ax - 0.26, y - 0.04, z + 0.52, 0.37, 0.38, 0.4);
  const temporal = ell(ax - 0.4, y + 0.25, z - 0.1, 0.17, 0.15, 0.44);
  let h = smin(smin(smin(main, front, 0.2), back, 0.2), temporal, 0.14);
  // The longitudinal fissure between the hemispheres, deepest on top.
  h += 0.1 * Math.exp(-((ax / 0.03) ** 2)) * (0.55 + 0.45 * smoothstep(-0.2, 0.4, y));
  const cere = ell(x, y + 0.41, z + 0.8, 0.42, 0.21, 0.26);
  h = smin(h, cere, 0.06);
  return smin(h, stem(x, y, z), 0.1);
}

/** How much of a point belongs to the cerebellum: it gets fine horizontal folia instead of gyri. */
const cerebellumness = (x: number, y: number, z: number) => {
  const d = ell(x, y + 0.41, z + 0.8, 0.48, 0.26, 0.31);
  return 1 - smoothstep(-0.02, 0.07, d);
};

/** Bulk plus cortical folds. `fold` scales how deep they are (the shell uses a gentler version). */
export function field(x: number, y: number, z: number, fold = 1) {
  const h = bulk(x, y, z);
  if (h > 0.12) return h;
  const cb = cerebellumness(x, y, z);
  const n1 = noise(x * 7.4 + 3.1, y * 7.4 - 1.7, z * 7.4 + 8.3);
  const n2 = noise(x * 15 - 7.7, y * 15 + 2.2, z * 15 + 4.9);
  const ridge = Math.abs(n1 + 0.55 * n2);
  const groove = 1 - smoothstep(0, 0.2, ridge);
  const gyri = 0.03 * groove + 0.01 * n2;
  const folia = 0.011 * (0.5 + 0.5 * Math.sin(y * 150 + n1 * 3.2)) + 0.004 * n2;
  return h + fold * (gyri * (1 - cb) + folia * cb);
}

/** Result of sampling the cortex: tiny glowing points on the folded surface. */
export type Cortex = {
  count: number;
  positions: Float32Array;
  normals: Float32Array;
  /** Per point: random seed, dominant lobe, how strongly it belongs to it, and how deep in a groove. */
  seeds: Float32Array;
  lobes: Float32Array;
  mixes: Float32Array;
  grooves: Float32Array;
};

/** Normalised distance from a lobe's centre: 1 on its boundary. */
export function lobeDistance(lobe: Lobe3D, x: number, y: number, z: number) {
  const px = lobe.sym ? Math.abs(x) : x;
  const cx = lobe.sym ? lobe.center[0] : lobe.center[0];
  const dx = (px - cx) / lobe.radii[0];
  const dy = (y - lobe.center[1]) / lobe.radii[1];
  const dz = (z - lobe.center[2]) / lobe.radii[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

let cached: Cortex | null = null;
let cachedCount = 0;

export function sampleCortex(target: number): Cortex {
  if (cached && cachedCount === target) return cached;
  const rand = seeded('bhippi-cortex');
  const positions = new Float32Array(target * 3);
  const normals = new Float32Array(target * 3);
  const seeds = new Float32Array(target);
  const lobes = new Float32Array(target);
  const mixes = new Float32Array(target);
  const grooves = new Float32Array(target);
  const eps = 0.004;
  let count = 0;
  let tries = 0;
  while (count < target && tries < target * 60) {
    tries += 1;
    let x = (rand() * 2 - 1) * 1.02;
    let y = -1.02 + rand() * 1.8;
    let z = -1.2 + rand() * 2.25;
    let s = field(x, y, z);
    if (Math.abs(s) > 0.07) continue;
    let gx = 0; let gy = 0; let gz = 0;
    for (let it = 0; it < 3; it += 1) {
      gx = field(x + eps, y, z) - s;
      gy = field(x, y + eps, z) - s;
      gz = field(x, y, z + eps) - s;
      const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
      gx /= len; gy /= len; gz /= len;
      x -= gx * s; y -= gy * s; z -= gz * s;
      s = field(x, y, z);
    }
    if (Math.abs(s) > 0.012) continue;
    const i = count;
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    normals[i * 3] = gx; normals[i * 3 + 1] = gy; normals[i * 3 + 2] = gz;
    seeds[i] = rand();
    // Which lobe tints this point, and how much.
    let best = 0; let bestW = 0;
    for (let l = 0; l < LOBES.length; l += 1) {
      const d = lobeDistance(LOBES[l], x, y, z);
      const w = Math.exp(-d * d * 0.9);
      if (w > bestW) { bestW = w; best = l; }
    }
    lobes[i] = best;
    mixes[i] = bestW;
    // Depth of the fold at this point: grooves read darker, crowns brighter.
    grooves[i] = Math.max(0, Math.min(1, (bulk(x, y, z) - s) / 0.04));
    count += 1;
  }
  cached = { count, positions, normals, seeds, lobes, mixes, grooves };
  cachedCount = target;
  return cached;
}

/** A neuron's home: deterministic by id, inside its lobe and beneath the cortex. */
export function placeNeuron(lobe: Lobe3D, id: string): [number, number, number] {
  const rand = seeded(id);
  const side = rand() < 0.5 ? -1 : 1;
  let x = lobe.center[0]; let y = lobe.center[1]; let z = lobe.center[2];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    let u = 0; let v = 0; let w = 0;
    do { u = rand() * 2 - 1; v = rand() * 2 - 1; w = rand() * 2 - 1; } while (u * u + v * v + w * w > 1);
    const px = lobe.center[0] + u * lobe.radii[0];
    const py = lobe.center[1] + v * lobe.radii[1];
    const pz = lobe.center[2] + w * lobe.radii[2];
    const cx = lobe.sym ? px * side : px;
    const s = bulk(cx, py, pz);
    x = cx; y = py; z = pz;
    if (s < -0.035 && s > -0.3) break;
  }
  return [x, y, z];
}
