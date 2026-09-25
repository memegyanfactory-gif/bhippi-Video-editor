// Draws a posed character with Canvas2D: flat fills, rubber-hose limbs bent by two-bone IK, a
// face of replacement drawings (almond or googly eyes with lids and a star catchlight, mouths by
// viseme and expression). The three base characters are original designs for Helios.
import type { Vec } from '../types';
import { PALETTES, RIGS, type Rig } from './pose';
import { CHARACTER_FEET, type CharacterKind, type CharacterPalette, type Expression, type Mouth, type Pose } from './types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Elbow (or knee) of a two-bone limb from `s` reaching for `t`; `bend` picks the side it folds to. */
export function twoBone(s: Vec, t: Vec, a: number, b: number, bend: number): { joint: Vec; end: Vec } {
  const dx = t[0] - s[0];
  const dy = t[1] - s[1];
  const dist = Math.max(Math.abs(a - b) + 1e-3, Math.min(a + b - 1e-3, Math.hypot(dx, dy)));
  const base = Math.atan2(dy, dx);
  const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
  const angle = base + bend * Math.acos(Math.max(-1, Math.min(1, cosA)));
  const joint: Vec = [s[0] + Math.cos(angle) * a, s[1] + Math.sin(angle) * a];
  const end: Vec = [s[0] + Math.cos(base) * dist, s[1] + Math.sin(base) * dist];
  return { joint, end };
}

function hose(ctx: Ctx, s: Vec, joint: Vec, end: Vec, width: number, color: string) {
  // A rubber-hose limb: one smooth curve through the joint.
  const c: Vec = [2 * joint[0] - (s[0] + end[0]) / 2, 2 * joint[1] - (s[1] + end[1]) / 2];
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s[0], s[1]);
  ctx.quadraticCurveTo(c[0], c[1], end[0], end[1]);
  ctx.stroke();
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

function star(ctx: Ctx, x: number, y: number, r: number, color: string) {
  const w = r * 0.28;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + w, y - w, x + r, y);
  ctx.quadraticCurveTo(x + w, y + w, x, y + r);
  ctx.quadraticCurveTo(x - w, y + w, x - r, y);
  ctx.quadraticCurveTo(x - w, y - w, x, y - r);
  ctx.fill();
}

/** One eye: almond (dome kid), googly (buddy) or dot (corporate), with lids for blinks and expressions. */
function eye(ctx: Ctx, style: 'almond' | 'googly' | 'dot', cx: number, cy: number, w: number, open: number, look: Vec, expression: Expression, side: number, p: CharacterPalette, lidColor: string) {
  const h = style === 'almond' ? w / 1.9 : style === 'googly' ? w : w * 1.3;
  const wide = expression === 'wide' ? 1.22 : 1;
  const ow = w * wide;
  const oh = h * wide * Math.max(1, open);
  if (expression === 'closed' || open <= 0.02) {
    ctx.strokeStyle = p.line;
    ctx.lineWidth = Math.max(2, w * 0.09);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - ow / 2, cy);
    ctx.quadraticCurveTo(cx, cy + oh * 0.35, cx + ow / 2, cy);
    ctx.stroke();
    return;
  }
  if (expression === 'happy') {
    ctx.strokeStyle = p.line;
    ctx.lineWidth = Math.max(2, w * 0.1);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - ow / 2, cy + oh * 0.15);
    ctx.quadraticCurveTo(cx, cy - oh * 0.75, cx + ow / 2, cy + oh * 0.15);
    ctx.stroke();
    return;
  }
  ctx.save();
  ctx.beginPath();
  if (style === 'almond') {
    ctx.moveTo(cx - ow / 2, cy);
    ctx.quadraticCurveTo(cx, cy - oh, cx + ow / 2, cy);
    ctx.quadraticCurveTo(cx, cy + oh, cx - ow / 2, cy);
  } else ctx.ellipse(cx, cy, ow / 2, oh / 2, 0, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = style === 'dot' ? p.pupil : p.eye;
  ctx.fill();
  ctx.clip();
  if (style !== 'dot') {
    const pr = ow * (style === 'googly' ? 0.26 : 0.225) / (expression === 'wide' ? 1.15 : 1);
    const lx = look[0] + (expression === 'side' ? 0.8 : 0);
    const px = cx + lx * (ow / 2 - pr) * 0.85;
    const py = cy + look[1] * (oh / 2 - pr) * 0.7;
    ellipse(ctx, px, py, pr, pr, p.pupil);
    star(ctx, px - pr * 0.35, py - pr * 0.35, pr * 0.5, '#ffffff');
  } else {
    ellipse(ctx, cx - ow * 0.15 + look[0] * 2, cy - oh * 0.2 + look[1] * 2, ow * 0.16, ow * 0.16, '#ffffff');
  }
  // Lids: blinks close from the top; sad, determined and unsure cut the eye at an angle.
  const top = cy - oh / 2 - 2;
  const lid = (y0: number, y1: number) => {
    ctx.fillStyle = lidColor;
    ctx.beginPath();
    ctx.moveTo(cx - ow, top - oh);
    ctx.lineTo(cx + ow, top - oh);
    ctx.lineTo(cx + ow, y1);
    ctx.lineTo(cx - ow, y0);
    ctx.closePath();
    ctx.fill();
  };
  const blinkY = top + (1 - Math.min(1, open)) * (oh + 4);
  if (open < 1) lid(blinkY, blinkY);
  const inner = side < 0 ? 1 : -1; // which way the inner corner is
  if (expression === 'sad') lid(cy - oh * (inner > 0 ? 0.55 : 0.05), cy - oh * (inner > 0 ? 0.05 : 0.55));
  if (expression === 'determined') lid(cy - oh * (inner > 0 ? 0.1 : 0.5), cy - oh * (inner > 0 ? 0.5 : 0.1));
  if (expression === 'unsure' && side > 0) lid(cy - oh * 0.05, cy - oh * 0.05);
  ctx.restore();
}

function mouth(ctx: Ctx, cx: number, cy: number, m: number, shape: Mouth, p: CharacterPalette) {
  ctx.strokeStyle = p.line;
  ctx.fillStyle = p.mouth;
  ctx.lineWidth = Math.max(2, m * 0.22);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const line = (d: () => void) => { ctx.beginPath(); d(); ctx.stroke(); };
  const fill = (rx: number, ry: number, dy = 0) => { ctx.beginPath(); ctx.ellipse(cx, cy + dy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2); ctx.fill(); };
  switch (shape) {
    case 'rest': line(() => { ctx.moveTo(cx - m * 0.45, cy - m * 0.1); ctx.quadraticCurveTo(cx, cy + m * 0.35, cx + m * 0.45, cy - m * 0.1); }); break;
    case 'smile': line(() => { ctx.moveTo(cx - m, cy - m * 0.25); ctx.quadraticCurveTo(cx, cy + m * 0.8, cx + m, cy - m * 0.25); }); break;
    case 'grin':
      ctx.beginPath();
      ctx.moveTo(cx - m, cy - m * 0.3);
      ctx.lineTo(cx + m, cy - m * 0.3);
      ctx.quadraticCurveTo(cx + m, cy + m * 1.1, cx, cy + m * 1.1);
      ctx.quadraticCurveTo(cx - m, cy + m * 1.1, cx - m, cy - m * 0.3);
      ctx.fill();
      ctx.fillStyle = '#ff8fa3';
      fill(m * 0.45, m * 0.25, m * 0.7);
      break;
    case 'flat': line(() => { ctx.moveTo(cx - m * 0.55, cy); ctx.lineTo(cx + m * 0.55, cy); }); break;
    case 'sad': line(() => { ctx.moveTo(cx - m * 0.7, cy + m * 0.3); ctx.quadraticCurveTo(cx, cy - m * 0.45, cx + m * 0.7, cy + m * 0.3); }); break;
    case 'o': fill(m * 0.42, m * 0.58); break;
    case 'A': fill(m * 0.62, m * 0.55); break;
    case 'E': fill(m * 0.8, m * 0.3); break;
    case 'O': fill(m * 0.4, m * 0.5); break;
    case 'M': line(() => { ctx.moveTo(cx - m * 0.5, cy); ctx.lineTo(cx + m * 0.5, cy); }); break;
    case 'F': line(() => { ctx.moveTo(cx - m * 0.5, cy); ctx.lineTo(cx + m * 0.5, cy); }); ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - m * 0.3, cy - m * 0.05, m * 0.6, m * 0.18); break;
    case 'L': fill(m * 0.5, m * 0.36); break;
    case 'scream': fill(m * 1.05, m * 1.15, m * 0.3); break;
  }
}

/** Body space → the pose: the feet point, facing, squash about the ground, lean about the hips.
 * Travel (pose.x / pose.y: walks, hops, leaps) moves the whole layer instead (evaluate.ts), so the
 * character never walks off its own canvas. */
function bodyTransform(ctx: Ctx, pose: Pose, rig: Rig, lean: boolean) {
  ctx.translate(CHARACTER_FEET[0], CHARACTER_FEET[1]);
  ctx.scale(pose.facing / Math.sqrt(pose.squash), pose.squash);
  if (lean) {
    ctx.translate(0, -rig.hip);
    ctx.rotate((pose.lean * Math.PI) / 180 * pose.facing);
    ctx.translate(0, rig.hip);
  }
}

export function drawCharacter(ctx: Ctx, kind: CharacterKind, palette: Partial<CharacterPalette> | undefined, pose: Pose, density: number) {
  const rig = RIGS[kind];
  const p = { ...PALETTES[kind], ...(palette ?? {}) };
  ctx.save();
  ctx.scale(density, density);

  // Legs (no lean: the feet stay planted).
  ctx.save();
  bodyTransform(ctx, pose, rig, false);
  for (const side of [-1, 1]) {
    const i = side < 0 ? 0 : 1;
    const hip: Vec = [side * rig.hipX, -rig.hip];
    const foot: Vec = [hip[0] + pose.feet[i][0], hip[1] + pose.feet[i][1]];
    const { joint, end } = twoBone(hip, foot, rig.thigh, rig.shin, -1);
    hose(ctx, hip, joint, end, rig.legWidth, p.bottom);
    ellipse(ctx, end[0] + 9, end[1] + 2, rig.legWidth * 1.05, rig.legWidth * 0.5, p.shoe);
  }
  ctx.restore();

  // Upper body, arms and head (leaning about the hips).
  ctx.save();
  bodyTransform(ctx, pose, rig, true);
  const shoulders: [Vec, Vec] = [[-rig.shoulderX, -rig.chest], [rig.shoulderX, -rig.chest]];
  const arm = (i: 0 | 1) => {
    const s = shoulders[i];
    const target: Vec = [s[0] + pose.hands[i][0], s[1] + pose.hands[i][1]];
    const { joint, end } = twoBone(s, target, rig.upperArm, rig.lowerArm, i === 0 ? 1 : -1);
    hose(ctx, s, joint, end, rig.armWidth, kind === 'shape-buddy' ? p.bottom : p.top);
    ellipse(ctx, end[0], end[1], rig.armWidth * 0.72, rig.armWidth * 0.72, kind === 'shape-buddy' ? p.bottom : p.skin);
  };
  const headAt: Vec = [0, -rig.neck + pose.headDip];

  if (kind === 'shape-buddy') {
    // A round body that is also the face.
    arm(0);
    arm(1);
    const [bw, bh] = rig.head;
    const cy = -rig.hip - bh / 2 + 28 + pose.headDip * 0.3;
    const g = ctx.createRadialGradient(-bw * 0.18, cy - bh * 0.22, bw * 0.05, 0, cy, bw * 0.62);
    g.addColorStop(0, '#ffffff66');
    g.addColorStop(0.25, p.top);
    g.addColorStop(1, p.bottom);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, cy, bw / 2, bh / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(0, cy);
    ctx.rotate((pose.headTilt * Math.PI) / 180);
    const shift = pose.turn * bw * 0.16;
    for (const side of [-1, 1]) eye(ctx, 'googly', shift + side * bw * 0.17, -bh * 0.1, bw * 0.24, pose.eyes, pose.look, pose.expression, side, p, p.top);
    mouth(ctx, shift, bh * 0.14, bw * 0.07, pose.mouth, p);
    ctx.restore();
    ctx.restore();
    ctx.restore();
    return;
  }

  // Torso.
  if (kind === 'dome-kid') {
    const topW = rig.shoulderX + 12;
    const botW = rig.hipX + 32;
    ctx.fillStyle = p.top;
    ctx.beginPath();
    ctx.moveTo(-topW, -rig.chest + 14);
    ctx.quadraticCurveTo(-topW, -rig.chest - 8, -topW + 22, -rig.chest - 8);
    ctx.lineTo(topW - 22, -rig.chest - 8);
    ctx.quadraticCurveTo(topW, -rig.chest - 8, topW, -rig.chest + 14);
    ctx.lineTo(botW, -rig.hip + 8);
    ctx.quadraticCurveTo(botW, -rig.hip + 20, botW - 14, -rig.hip + 20);
    ctx.lineTo(-botW + 14, -rig.hip + 20);
    ctx.quadraticCurveTo(-botW, -rig.hip + 20, -botW, -rig.hip + 8);
    ctx.closePath();
    ctx.fill();
    // Pocket and drawstrings.
    ctx.fillStyle = '#00000018';
    ctx.fillRect(-botW * 0.6, -rig.hip - 34, botW * 1.2, 26);
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 3;
    for (const x of [-9, 9]) { ctx.beginPath(); ctx.moveTo(x, -rig.chest + 2); ctx.lineTo(x * 1.2, -rig.chest + 42); ctx.stroke(); ellipse(ctx, x * 1.2, -rig.chest + 44, 3.5, 3.5, p.accent); }
    ellipse(ctx, 0, -rig.chest - 4, 40, 12, '#00000026');
  } else {
    // Shirt with a collar and a tie.
    ctx.fillStyle = p.top;
    const topW = rig.shoulderX + 10;
    ctx.beginPath();
    ctx.moveTo(-topW, -rig.chest + 10);
    ctx.quadraticCurveTo(-topW, -rig.chest - 10, -topW + 20, -rig.chest - 10);
    ctx.lineTo(topW - 20, -rig.chest - 10);
    ctx.quadraticCurveTo(topW, -rig.chest - 10, topW, -rig.chest + 10);
    ctx.lineTo(rig.hipX + 22, -rig.hip + 4);
    ctx.lineTo(-rig.hipX - 22, -rig.hip + 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath(); ctx.moveTo(-14, -rig.chest - 10); ctx.lineTo(0, -rig.chest + 12); ctx.lineTo(14, -rig.chest - 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e03131';
    ctx.beginPath(); ctx.moveTo(-5, -rig.chest + 2); ctx.lineTo(5, -rig.chest + 2); ctx.lineTo(8, -rig.chest + 70); ctx.lineTo(0, -rig.chest + 82); ctx.lineTo(-8, -rig.chest + 70); ctx.closePath(); ctx.fill();
    ctx.fillStyle = p.bottom;
    ctx.fillRect(-rig.hipX - 22, -rig.hip - 2, (rig.hipX + 22) * 2, 12);
  }

  // Head.
  ctx.save();
  ctx.translate(headAt[0], headAt[1]);
  ctx.rotate((pose.headTilt * Math.PI) / 180);
  const [hw, hh] = rig.head;
  const shift = pose.turn * hw * 0.18;
  if (kind === 'dome-kid') {
    // A flat dome (a mushroom cap, w:h ≈ 2.3:1), no outline; features slide over it when it turns.
    for (const side of [-1, 1]) if (!(pose.turn * side < -0.45)) {
      ellipse(ctx, side * hw * 0.47 + shift * 0.4, -hh * 0.14, 11, 15, p.skin);
      ellipse(ctx, side * hw * 0.47 + shift * 0.4, -hh * 0.08, 5, 8, '#00000022');
    }
    ctx.fillStyle = p.skin;
    ctx.beginPath();
    ctx.moveTo(-hw / 2, 0);
    ctx.bezierCurveTo(-hw / 2, -hh * 1.3, hw / 2, -hh * 1.3, hw / 2, 0);
    ctx.quadraticCurveTo(0, hh * 0.24, -hw / 2, 0);
    ctx.fill();
    ctx.fillStyle = '#0000001a';
    ctx.beginPath();
    ctx.moveTo(-hw / 2, 0);
    ctx.quadraticCurveTo(0, hh * 0.24, hw / 2, 0);
    ctx.quadraticCurveTo(0, hh * 0.1, -hw / 2, 0);
    ctx.fill();
    for (const side of [-1, 1]) eye(ctx, 'almond', shift + side * hw * 0.16, -hh * 0.4, hw * 0.19, pose.eyes, pose.look, pose.expression, side, p, p.skin);
    mouth(ctx, shift, -hh * 0.12, 9, pose.mouth, p);
  } else {
    ellipse(ctx, 0, -12, 14, 16, p.skin); // neck
    for (const side of [-1, 1]) ellipse(ctx, side * hw * 0.5 + shift * 0.3, -hh * 0.45, 9, 13, p.skin);
    ellipse(ctx, 0, -hh * 0.5, hw / 2, hh / 2, p.skin);
    ctx.fillStyle = p.hair;
    ctx.beginPath();
    ctx.moveTo(-hw / 2 - 2, -hh * 0.5);
    ctx.bezierCurveTo(-hw / 2 - 6, -hh * 1.15, hw / 2 + 6, -hh * 1.15, hw / 2 + 2, -hh * 0.52);
    ctx.quadraticCurveTo(hw * 0.2 + shift, -hh * 0.78, -hw * 0.25 + shift, -hh * 0.74);
    ctx.quadraticCurveTo(-hw * 0.42, -hh * 0.7, -hw / 2 - 2, -hh * 0.5);
    ctx.fill();
    for (const side of [-1, 1]) eye(ctx, 'dot', shift + side * hw * 0.2, -hh * 0.46, hw * 0.1, pose.eyes, pose.look, pose.expression, side, p, p.skin);
    mouth(ctx, shift, -hh * 0.22, 11, pose.mouth, p);
  }
  ctx.restore();

  arm(0);
  arm(1);
  ctx.restore();
  ctx.restore();
}
