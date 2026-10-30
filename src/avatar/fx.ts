// What flies out of a hero's hands, drawn on the avatar's effects canvas in the same chunky pixels
// as everything else: a web line, a batarang, a card, a repulsor blast, a shield that ricochets and
// comes back, an arrow, three claw marks, a tornado, the ring of a ground smash. The engine owns the
// timing (it decides when a strike lands and what the landing does); this file only draws one
// projectile at one moment, and says how long it lasts.

import type { Strike } from './heroPoses';

type Vec = { x: number; y: number };

export type FxKind = Strike | 'shock' | 'rope-web' | 'rope-grapple'
  // The signature moves: the chest beam, a smash cracking the ground, a ring of energy, a shield
  // ringing round a path of panels, an arrow lobbed high.
  | 'unibeam' | 'cracks' | 'pulse' | 'ricochet' | 'lob';
export type Projectile = {
  kind: FxKind; from: Vec; to: Vec; t0: number; dur: number; facing: 1 | -1;
  /** A ring's colour (pulse), and how much bigger than usual it is drawn (shock, pulse, cracks). */
  color?: string; size?: number;
  /** The points a ricochet goes through between `from` and `to`. */
  path?: Vec[];
};

/** How long each kind lasts on screen, in ms (the engine lands the blow at `LANDS` of that). */
export const FX_MS: Record<Strike, number> = {
  web: 520, batarang: 760, card: 420, swipe: 340, blast: 320, smash: 520, beam: 420, arrow: 720, shield: 900, claw: 360, whirl: 700,
};
/** The moment, as a fraction of its length, the projectile reaches its target. */
export const LANDS: Record<Strike, number> = {
  web: 0.25, batarang: 0.45, card: 0.7, swipe: 0.3, blast: 0.2, smash: 0.05, beam: 0.25, arrow: 0.25, shield: 0.4, claw: 0.55, whirl: 0.7,
};

const lerp = (a: Vec, b: Vec, u: number): Vec => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Draws projectile `p` at `now`; false once it is over. */
export function drawProjectile(ctx: CanvasRenderingContext2D, p: Projectile, now: number, S: number): boolean {
  const u = (now - p.t0) / p.dur;
  if (u < 0) return true;
  if (u >= 1) return false;
  const px = (x: number, y: number, c: string, n = 1) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x / S) * S, Math.round(y / S) * S, S * n, S * n);
  };
  const line = (a: Vec, b: Vec, c: string, n = 1) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / S));
    for (let i = 0; i <= steps; i++) px(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, c, n);
  };
  const blink = (from: number) => u > from && Math.floor(u * 40) % 2 === 0;

  switch (p.kind) {
    case 'web': {
      // The line shoots out, sticks, then blinks away; a little web is left where it hit.
      const head = lerp(p.from, p.to, clamp01(u / 0.25));
      if (blink(0.75)) return true;
      line(p.from, head, '#eaf3ff');
      px(head.x - S / 2, head.y - S / 2, '#ffffff', 2);
      if (u > 0.25) {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          line({ x: p.to.x + Math.cos(a) * 3, y: p.to.y + Math.sin(a) * 3 }, { x: p.to.x + Math.cos(a) * 12, y: p.to.y + Math.sin(a) * 12 }, '#eaf3ff');
        }
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          px(p.to.x + Math.cos(a) * 8, p.to.y + Math.sin(a) * 8, '#eaf3ff');
        }
      }
      return true;
    }
    case 'batarang': {
      // Out in a curve to the target, then boomeranging back to the hand.
      const out = u < 0.5;
      const v = out ? u / 0.5 : (u - 0.5) / 0.5;
      const here = lerp(out ? p.from : p.to, out ? p.to : p.from, v);
      const bow = Math.sin(v * Math.PI) * -26;
      const x = here.x;
      const y = here.y + bow;
      const a = u * 38;
      for (const s of [-1, 1]) {
        for (let k = 1; k <= 3; k++) px(x + Math.cos(a + s * 0.9) * k * S * 1.5, y + Math.sin(a + s * 0.9) * k * S * 1.5, k === 3 ? '#e8eef8' : '#8792a8');
      }
      px(x, y, '#14151f', 2);
      return true;
    }
    case 'card': {
      const pos = lerp(p.from, p.to, clamp01(u / 0.7));
      if (u > 0.7) return true;
      const wide = Math.floor(u * 22) % 2 === 0;
      const w = wide ? 3 : 4;
      const h = wide ? 4 : 3;
      for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) px(pos.x + i * S, pos.y + j * S, '#ffffff');
      px(pos.x + S, pos.y + S, '#c8102e');
      return true;
    }
    case 'swipe':
    case 'claw': {
      // Parallel slashes drawn across the target, the end of each racing ahead.
      const silver = p.kind === 'claw';
      const col = silver ? '#d8dfef' : '#ffffff';
      const sweep = clamp01(u / 0.5);
      if (blink(0.7)) return true;
      for (let i = -1; i <= 1; i++) {
        const a = { x: p.to.x - 16 + i * 7 * p.facing, y: p.to.y - 14 };
        const b = { x: p.to.x + 8 + i * 7 * p.facing, y: p.to.y + 14 };
        line(a, lerp(a, b, sweep), col);
        if (silver) line({ x: a.x + S, y: a.y }, lerp({ x: a.x + S, y: a.y }, { x: b.x + S, y: b.y }, sweep), '#8e99b8');
      }
      return true;
    }
    case 'blast': {
      // A thick cyan beam with a white core, flickering, with a flare at each end.
      if (u > 0.75) return true;
      const wide = Math.floor(u * 40) % 2 === 0 ? 2 : 3;
      const reach = lerp(p.from, p.to, clamp01(u / 0.2));
      line(p.from, reach, '#7df3ff', wide);
      line(p.from, reach, '#ffffff', 1);
      px(p.from.x - S, p.from.y - S, '#ffffff', 3);
      if (u > 0.2) {
        px(p.to.x - 2 * S, p.to.y - 2 * S, '#7df3ff', 5);
        px(p.to.x - S, p.to.y - S, '#ffffff', 3);
      }
      return true;
    }
    case 'beam': {
      // Calm and steady: a golden thread from the brow, pulsing.
      if (u > 0.8) return true;
      const reach = lerp(p.from, p.to, clamp01(u / 0.25));
      const pulse = Math.floor(u * 24) % 2;
      line(p.from, reach, '#ffe040', pulse ? 2 : 1);
      line(p.from, reach, '#fffbe0', 1);
      if (u > 0.25) for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + u * 6;
        px(p.to.x + Math.cos(a) * (6 + pulse * 3), p.to.y + Math.sin(a) * (6 + pulse * 3), '#ffe040');
      }
      return true;
    }
    case 'arrow': {
      const head = lerp(p.from, p.to, clamp01(u / 0.25));
      if (blink(0.8)) return true;
      const dx = p.to.x - p.from.x;
      const dy = p.to.y - p.from.y;
      const d = Math.hypot(dx, dy) || 1;
      const tail = { x: head.x - (dx / d) * S * 7, y: head.y - (dy / d) * S * 7 };
      line(tail, head, '#cdd5e5');
      px(head.x, head.y, '#ffffff', 2);
      px(tail.x - S, tail.y - S, '#ffffff');
      px(tail.x + S, tail.y + S, '#ffffff');
      return true;
    }
    case 'shield': {
      // To the target, ricochets up and away, then home to the hand.
      const bounce = { x: p.to.x + (p.to.x >= p.from.x ? 46 : -46), y: p.to.y - 56 };
      let pos: Vec;
      if (u < 0.4) pos = lerp(p.from, p.to, u / 0.4);
      else if (u < 0.6) pos = lerp(p.to, bounce, (u - 0.4) / 0.2);
      else pos = lerp(bounce, p.from, (u - 0.6) / 0.4);
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const r = Math.hypot(dx, dy);
          if (r > 4.2) continue;
          px(pos.x + dx * S, pos.y + dy * S, r <= 1.6 ? '#2c4fa0' : r <= 2.6 ? '#ffffff' : r <= 3.4 ? '#c8222e' : '#ffffff');
        }
      }
      px(pos.x, pos.y, '#ffffff');
      return true;
    }
    case 'whirl': {
      // A little tornado that runs to the target and unwinds there.
      const pos = lerp(p.from, p.to, clamp01(u / 0.7));
      const fade = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
      for (let i = 0; i < 6; i++) {
        const r = (5 + i * 3) * fade;
        const y = pos.y - i * 7 * S * 0.5;
        const a = u * 30 + i * 1.3;
        for (let k = 0; k < 8; k++) {
          const ang = a + (k / 8) * Math.PI * 2;
          px(pos.x + Math.cos(ang) * r * S * 0.5, y + Math.sin(ang) * r * S * 0.12, i % 2 ? '#ffffff' : '#9cc4ee');
        }
      }
      return true;
    }
    case 'unibeam': {
      // A wide white-hot beam from the chest, flaring at both ends, flickering as it goes out.
      if (u > 0.85 || blink(0.7)) return true;
      const reach = lerp(p.from, p.to, clamp01(u / 0.15));
      const wide = Math.floor(u * 40) % 2 ? 5 : 4;
      line({ x: p.from.x, y: p.from.y - S * 2 }, { x: reach.x, y: reach.y - S * 2 }, '#7df3ff', wide);
      line(p.from, reach, '#ffffff', 2);
      px(p.from.x - 3 * S, p.from.y - 3 * S, '#ffffff', 6);
      if (u > 0.15) {
        px(p.to.x - 4 * S, p.to.y - 4 * S, '#7df3ff', 8);
        px(p.to.x - 2 * S, p.to.y - 2 * S, '#ffffff', 4);
      }
      return true;
    }
    case 'cracks': {
      // Jagged cracks running out along the ground from a slam, then blinking away.
      if (blink(0.75)) return true;
      const grow = clamp01(u / 0.25) * (p.size ?? 1);
      for (const dir of [-1, 1]) {
        for (let branch = 0; branch < 3; branch++) {
          let x = p.to.x;
          let y = p.to.y - 1;
          const steps = Math.round((8 + branch * 5) * grow);
          for (let i = 0; i < steps; i++) {
            x += dir * S * 1.5;
            y += ((i * 7 + branch * 3) % 5 === 0 ? -1 : (i + branch) % 4 === 0 ? 1 : 0) * S + (branch - 1) * S * 0.25;
            px(x, y, i % 3 ? '#2a1a26' : '#5a4636');
          }
        }
      }
      return true;
    }
    case 'pulse': {
      // A round ring of energy swelling out from the source and fading.
      if (blink(0.65)) return true;
      const r = (8 + u * 120) * (p.size ?? 1);
      const color = p.color ?? '#b57bff';
      for (let k = 0; k < 48; k++) {
        const ang = (k / 48) * Math.PI * 2;
        px(p.to.x + Math.cos(ang) * r, p.to.y + Math.sin(ang) * r * 0.75, k % 2 ? '#ffffff' : color, u < 0.3 ? 2 : 1);
      }
      return true;
    }
    case 'ricochet': {
      // The shield from point to point (each a panel it rings off), and home to the hand.
      const stops = [p.from, ...(p.path ?? []), p.to];
      const legs = stops.length - 1;
      const at = Math.min(legs - 1e-6, u * legs);
      const leg = Math.floor(at);
      const pos = lerp(stops[leg], stops[leg + 1], at - leg);
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const r = Math.hypot(dx, dy);
          if (r > 4.2) continue;
          px(pos.x + dx * S, pos.y + dy * S, r <= 1.6 ? '#2c4fa0' : r <= 2.6 ? '#ffffff' : r <= 3.4 ? '#c8222e' : '#ffffff');
        }
      }
      // A streak behind it.
      const back = lerp(stops[leg], stops[leg + 1], Math.max(0, at - leg - 0.12));
      line(back, pos, '#9cc4ee');
      return true;
    }
    case 'lob': {
      // An arrow lobbed high: up, over, and down onto its mark, nose following the curve.
      if (u > 0.82) return true;
      const v = clamp01(u / 0.7);
      const peak = Math.min(p.from.y, p.to.y) - 160;
      const at = (w: number): Vec => ({ x: p.from.x + (p.to.x - p.from.x) * w, y: (1 - w) ** 2 * p.from.y + 2 * (1 - w) * w * peak + w * w * p.to.y });
      const head = at(v);
      const tail = at(Math.max(0, v - 0.05));
      const d = Math.hypot(head.x - tail.x, head.y - tail.y) || 1;
      const end = { x: head.x - ((head.x - tail.x) / d) * S * 7, y: head.y - ((head.y - tail.y) / d) * S * 7 };
      line(end, head, '#cdd5e5');
      px(head.x, head.y, '#ffffff', 2);
      px(end.x - S, end.y - S, '#ff7a45');
      px(end.x + S, end.y + S, '#ff7a45');
      return true;
    }
    case 'shock': {
      // The ring of a smash, spreading along the ground and thinning out.
      if (blink(0.6)) return true;
      const r = u * 110 * (p.size ?? 1);
      for (let k = 0; k < 40; k++) {
        const ang = (k / 40) * Math.PI * 2;
        px(p.to.x + Math.cos(ang) * r, p.to.y - 3 + Math.sin(ang) * r * 0.22, k % 2 ? '#fff1c2' : '#ffc23d', 1);
      }
      return true;
    }
    case 'smash': return false;
    case 'rope-web':
    case 'rope-grapple': {
      const web = p.kind === 'rope-web';
      line(p.from, p.to, web ? '#eaf3ff' : '#8792a8');
      px(p.to.x - S / 2, p.to.y - S / 2, web ? '#ffffff' : '#14151f', 2);
      return true;
    }
  }
}
