// Particles (docs/REFERENCE-FILMS-PLAN.md P5, B3): confetti, sparkles, dust, bokeh, speed lines,
// snow, embers and bursts, as one layer. Every particle's state is a closed-form function of the
// seed and the time — spawn, drag, gravity, flutter, spin, twinkle — with no simulation state, so
// any frame renders the same in the preview, a scrub and the export. Drawn with Canvas2D like the
// shapes and uploaded as a texture.
import type { Vec } from './types';

export const PARTICLE_PRESETS = ['confetti', 'confetti-burst', 'sparkle', 'dust', 'bokeh', 'speed-lines', 'snow', 'embers', 'burst', 'ripple-rings'] as const;
export type ParticlePreset = (typeof PARTICLE_PRESETS)[number];

export type ParticleData = {
  preset: ParticlePreset;
  /** How many: the burst's total, or how many are alive at once for continuous presets. */
  count?: number;
  seed?: number;
  colors?: string[];
  /** Burst origin / sparkle centre, layer px (default the layer centre). */
  at?: Vec;
  /** Spawn region [x, y, w, h] in layer px (default the whole layer). */
  area?: Vec;
  /** Seconds the emission starts (a burst fires then). */
  start?: number;
  /** Seconds it keeps emitting (continuous presets; default forever). */
  duration?: number;
  /** Speed multiplier (1 = the preset's own). */
  speed?: number;
  /** Size multiplier. */
  size?: number;
  /** Degrees the stream flows toward (speed lines, dust wind): 0 = right, 90 = down. */
  direction?: number;
  /** px/s² (confetti default 900). */
  gravity?: number;
  /** 0–100. */
  opacity?: number;
};

export type ParticleState = { x: number; y: number; size: number; rotation: number; flip: number; opacity: number; color: string; shape: 'rect' | 'circle' | 'soft' | 'star' | 'streak' | 'ring'; length?: number; angle?: number };

type Spec = {
  life: [number, number];
  continuous: boolean;
  count: number;
  colors: string[];
  shape: ParticleState['shape'];
  size: [number, number];
};

const SPECS: Record<ParticlePreset, Spec> = {
  confetti: { life: [2.6, 3.8], continuous: true, count: 90, colors: ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#7b61ff', '#ffffff'], shape: 'rect', size: [10, 18] },
  'confetti-burst': { life: [1.8, 2.8], continuous: false, count: 120, colors: ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#7b61ff', '#ffffff'], shape: 'rect', size: [10, 18] },
  sparkle: { life: [0.9, 1.8], continuous: true, count: 26, colors: ['#ffffff', '#fff4c2', '#d6e4ff'], shape: 'star', size: [14, 34] },
  dust: { life: [5, 9], continuous: true, count: 70, colors: ['#ffffff'], shape: 'circle', size: [1.5, 4] },
  bokeh: { life: [6, 10], continuous: true, count: 18, colors: ['#ffffff', '#b9c7ff', '#ffd7f0'], shape: 'soft', size: [40, 140] },
  'speed-lines': { life: [0.35, 0.7], continuous: true, count: 40, colors: ['#ffffff'], shape: 'streak', size: [2, 4] },
  snow: { life: [6, 10], continuous: true, count: 120, colors: ['#ffffff'], shape: 'circle', size: [2, 6] },
  embers: { life: [2, 4], continuous: true, count: 45, colors: ['#ffb347', '#ff6a2a', '#ffd28a'], shape: 'circle', size: [2, 5] },
  burst: { life: [0.45, 0.7], continuous: false, count: 14, colors: ['#ffffff'], shape: 'streak', size: [4, 7] },
  'ripple-rings': { life: [0.9, 1.1], continuous: false, count: 3, colors: ['#ffffff'], shape: 'ring', size: [220, 320] },
};

/** A tiny deterministic hash → [0, 1). */
function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fade = (age: number, life: number, inS: number, outS: number) => Math.max(0, Math.min(1, age / Math.max(1e-3, inS), (life - age) / Math.max(1e-3, outS)));

/** Displacement under linear drag k and constant acceleration g after `a` seconds. */
const drift = (v0: number, g: number, k: number, a: number) => (k < 1e-6 ? v0 * a + 0.5 * g * a * a : (g / k) * a + (v0 - g / k) * (1 - Math.exp(-k * a)) / k);

export function particlesAt(data: ParticleData, size: [number, number], t: number): ParticleState[] {
  const spec = SPECS[data.preset];
  if (!spec) return [];
  const [W, H] = size;
  const area = data.area && data.area.length >= 4 ? data.area : [0, 0, W, H];
  const at = data.at ?? [W / 2, H / 2];
  const start = data.start ?? 0;
  const end = data.duration !== undefined ? start + data.duration : Infinity;
  const count = Math.max(1, Math.min(600, Math.round(data.count ?? spec.count)));
  const seed = data.seed ?? 1;
  const speed = data.speed ?? 1;
  const scale = data.size ?? 1;
  const colors = data.colors?.length ? data.colors : spec.colors;
  const master = (data.opacity ?? 100) / 100;
  const dir = ((data.direction ?? (data.preset === 'speed-lines' ? 180 : 90)) * Math.PI) / 180;
  const out: ParticleState[] = [];

  for (let i = 0; i < count; i++) {
    let cycle = 0;
    let spawn: number;
    const life0 = lerp(spec.life[0], spec.life[1], hash(seed, i, 7));
    if (spec.continuous) {
      // Particle i is reborn every life seconds, staggered so the field starts full.
      const phase = hash(seed, i, 3) * life0;
      const since = t - start + phase;
      cycle = Math.floor(since / life0);
      spawn = start - phase + cycle * life0;
      if (spawn > end) continue;
    } else {
      spawn = start + hash(seed, i, 3) * 0.06;
    }
    const age = t - spawn;
    const r = (k: number) => hash(seed + cycle * 7919, i, k);
    const life = spec.continuous ? life0 : lerp(spec.life[0], spec.life[1], r(11));
    if (age < 0 || age > life) continue;
    const size0 = lerp(spec.size[0], spec.size[1], r(13)) * scale;
    const color = colors[Math.floor(r(17) * colors.length) % colors.length];
    const sx = area[0] + r(19) * area[2];
    const sy = area[1] + r(23) * area[3];
    let p: ParticleState;
    switch (data.preset) {
      case 'confetti': {
        const g = data.gravity ?? 260;
        const x = sx + Math.sin(age * lerp(2, 4, r(29)) + r(31) * 6.28) * lerp(20, 60, r(37));
        const y = area[1] - 40 + drift(lerp(80, 180, r(41)) * speed, g * speed, 1.2, age);
        p = { x, y, size: size0, rotation: age * lerp(-400, 400, r(43)), flip: Math.cos(age * lerp(6, 14, r(47)) + r(53) * 6), opacity: fade(age, life, 0.1, 0.5), color, shape: 'rect' };
        break;
      }
      case 'confetti-burst': {
        const g = data.gravity ?? 900;
        const angle = -Math.PI / 2 + (r(29) - 0.5) * Math.PI * 1.1;
        const v = lerp(700, 1500, r(31)) * speed;
        const x = at[0] + drift(Math.cos(angle) * v, 0, 2.4, age) + Math.sin(age * 5 + r(37) * 6) * 12;
        const y = at[1] + drift(Math.sin(angle) * v, g * speed, 2.4, age);
        p = { x, y, size: size0, rotation: age * lerp(-500, 500, r(41)), flip: Math.cos(age * lerp(7, 15, r(43))), opacity: fade(age, life, 0.02, 0.6), color, shape: 'rect' };
        break;
      }
      case 'sparkle': {
        const tw = Math.sin((age / life) * Math.PI);
        p = { x: sx, y: sy, size: size0 * (0.4 + 0.6 * tw), rotation: age * 40, flip: 1, opacity: tw * tw, color, shape: 'star' };
        break;
      }
      case 'dust':
      case 'snow': {
        const wind = data.preset === 'snow' ? 24 : 10;
        const fall = data.preset === 'snow' ? lerp(40, 90, r(29)) : lerp(-8, 8, r(29));
        const x = sx + Math.cos(dir) * wind * age * speed + Math.sin(age * lerp(0.4, 1.2, r(31)) + r(37) * 6) * lerp(6, 24, r(41));
        const y = (data.preset === 'snow' ? area[1] - 10 : sy) + (fall + Math.sin(dir) * wind * 0.3) * age * speed;
        p = { x, y, size: size0, rotation: 0, flip: 1, opacity: fade(age, life, 1, 1.5) * (data.preset === 'dust' ? lerp(0.25, 0.7, r(43)) : lerp(0.6, 1, r(43))), color, shape: 'circle' };
        break;
      }
      case 'bokeh': {
        const x = sx + Math.sin(age * 0.3 + r(29) * 6) * 40 + Math.cos(dir) * 12 * age * speed;
        const y = sy + Math.cos(age * 0.25 + r(31) * 6) * 30 - 6 * age * speed;
        p = { x, y, size: size0, rotation: 0, flip: 1, opacity: fade(age, life, 1.5, 2) * lerp(0.12, 0.35, r(37)), color, shape: 'soft' };
        break;
      }
      case 'speed-lines': {
        const v = lerp(2200, 3600, r(29)) * speed;
        const x0 = area[0] + (Math.cos(dir) < 0 ? area[2] + 200 : -200);
        const x = x0 + Math.cos(dir) * v * age;
        const y = sy + Math.sin(dir) * v * age;
        p = { x, y, size: size0, rotation: 0, flip: 1, opacity: fade(age, life, 0.05, 0.15) * lerp(0.35, 0.9, r(31)), color, shape: 'streak', length: lerp(160, 520, r(37)), angle: dir };
        break;
      }
      case 'embers': {
        const x = sx + Math.sin(age * lerp(1, 2.5, r(29)) + r(31) * 6) * 30;
        const y = area[1] + area[3] + 10 - lerp(60, 160, r(37)) * age * speed;
        p = { x, y, size: size0 * (1 - 0.5 * (age / life)), rotation: 0, flip: 1, opacity: fade(age, life, 0.3, 1.2), color, shape: 'circle' };
        break;
      }
      case 'burst': {
        const angle = (i / count) * Math.PI * 2 + r(29) * 0.2;
        const reach = lerp(90, 170, r(31)) * scale;
        const q = 1 - Math.pow(1 - age / life, 3);
        const len = (1 - Math.abs(age / life * 2 - 0.8)) * 60 * scale;
        p = { x: at[0] + Math.cos(angle) * reach * q, y: at[1] + Math.sin(angle) * reach * q, size: size0, rotation: 0, flip: 1, opacity: fade(age, life, 0.02, 0.25), color, shape: 'streak', length: Math.max(4, len), angle };
        break;
      }
      case 'ripple-rings': {
        const delayed = age - i * 0.14;
        if (delayed < 0) continue;
        const q = 1 - Math.pow(1 - Math.min(1, delayed / (life - i * 0.14)), 3);
        p = { x: at[0], y: at[1], size: size0 * q, rotation: 0, flip: 1, opacity: 1 - q, color, shape: 'ring' };
        break;
      }
    }
    p.opacity *= master;
    if (p.opacity > 0.003 && p.x > -600 && p.y > -600 && p.x < W + 600 && p.y < H + 600) out.push(p);
  }
  return out;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function drawParticles(ctx: Ctx, list: ParticleState[], density: number) {
  for (const p of list) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.opacity));
    ctx.translate(p.x * density, p.y * density);
    const s = p.size * density;
    switch (p.shape) {
      case 'rect':
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.scale(1, Math.abs(p.flip) < 0.08 ? 0.08 : p.flip);
        ctx.fillStyle = p.color;
        ctx.fillRect(-s / 2, -s * 0.3, s, s * 0.6);
        break;
      case 'circle':
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'soft': {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
        g.addColorStop(0, p.color);
        g.addColorStop(0.55, p.color);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha *= 0.9;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'star': {
        ctx.rotate((p.rotation * Math.PI) / 180);
        const r = s / 2;
        const w = r * 0.18;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = r * 0.8;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.quadraticCurveTo(w, -w, r, 0);
        ctx.quadraticCurveTo(w, w, 0, r);
        ctx.quadraticCurveTo(-w, w, -r, 0);
        ctx.quadraticCurveTo(-w, -w, 0, -r);
        ctx.fill();
        break;
      }
      case 'streak': {
        const len = (p.length ?? 120) * density;
        ctx.rotate(p.angle ?? 0);
        const g = ctx.createLinearGradient(-len, 0, 0, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(1, p.color);
        ctx.strokeStyle = g;
        ctx.lineCap = 'round';
        ctx.lineWidth = s;
        ctx.beginPath();
        ctx.moveTo(-len, 0);
        ctx.lineTo(0, 0);
        ctx.stroke();
        break;
      }
      case 'ring':
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, 3 * density);
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(0.5, s / 2), 0, Math.PI * 2);
        ctx.stroke();
        break;
    }
    ctx.restore();
  }
}
