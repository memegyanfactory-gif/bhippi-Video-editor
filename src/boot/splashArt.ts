// The launch splash's artwork: a canvas drawing of construction geometry — golden-ratio circles, a
// protractor, a pen-tool curve with its handles, live measurements — and a small grid of "AI pixels"
// that flicker like a contribution graph. The Bhippi mark is half-built inside it.
//
// It is drawn inside a small card (the page's .splash-card) on a see-through window. finish() plays
// the ending: the construction folds away, the pixels fly into the ring, the mark completes and
// glides to the card's centre while the card grows to fill the window, then the camera pushes
// through the ring. The ring splits into ribbons of light and its hole opens onto the editor.
//
// Each launch seeds a slightly different composition (angles, drift, ribbon colours).

type Options = {
  /** The card the artwork lives in; the canvas itself covers the whole window. */
  card: HTMLElement;
  reducedMotion: boolean;
  /** The card has grown to fill the window: nothing behind the canvas shows any more. */
  onCovered: () => void;
  /** The camera starts through the ring: the page around the canvas should get out of the way. */
  onOpen: () => void;
  /** The last frame is drawn and the canvas is fully see-through. */
  onDone: () => void;
};

export type SplashArt = { finish: () => void; destroy: () => void };

const BG_LEFT = '#09090b';
const BG_ART = '#0e0d10';
const INK = (alpha: number) => `rgba(236, 226, 212, ${alpha})`;
const EMBER = (alpha: number) => `rgba(255, 122, 42, ${alpha})`;
const MONO = '"Cascadia Code", Consolas, monospace';

// The finale's phases, in seconds after finish().
const GATHER = 0.8;
const SETTLE = 0.5;
const OPEN = 1.15;
/** The card starts growing during the gather and fills the window before the push. */
const EXPAND_AT = 0.45;
const EXPAND = 0.75;
/** The card's corner radius, and where its info column ends (a share of its width). */
const RADIUS = 10;
const SPLIT = 0.46;

const clamp = (value: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const smooth = (a: number, b: number, t: number) => { const x = clamp((t - a) / (b - a)); return x * x * (3 - 2 * x); };
/** Progress of something that starts `delay` seconds in and lasts `duration`. */
const span = (t: number, delay: number, duration: number) => clamp((t - delay) / duration);

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── the Bhippi mark: a ring cut in two by vertical gaps, a B inside ─────────────────────────────
// Measured from public/bhippi.png, in units of the ring's outer radius.
const RING_INNER = 0.618;
const CUT_TOP = 0.085;
const CUT_BOTTOM = 0.165;

/** The angles where a circle of radius `r` meets the left half's top and bottom cuts. */
function cutAngles(r: number, ro: number) {
  const ct = CUT_TOP * ro;
  const cb = CUT_BOTTOM * ro;
  const radius = Math.max(r, cb * 1.05);
  return {
    top: Math.atan2(-Math.sqrt(radius * radius - ct * ct), -ct),
    bottom: Math.atan2(Math.sqrt(radius * radius - cb * cb), -cb),
  };
}

/** The left half of the ring (the right half is this mirrored). */
function ringHalf(ro: number): Path2D {
  const ri = ro * RING_INNER;
  const outer = cutAngles(ro, ro);
  const inner = cutAngles(ri, ro);
  const path = new Path2D();
  path.arc(0, 0, ro, outer.top, outer.bottom, true);
  path.arc(0, 0, ri, inner.bottom, inner.top, false);
  path.closePath();
  return path;
}

/** Both halves. */
function ringWhole(ro: number): Path2D {
  const half = ringHalf(ro);
  const path = new Path2D();
  path.addPath(half);
  path.addPath(half, new DOMMatrix([-1, 0, 0, 1, 0, 0]));
  return path;
}

function bPath(ctx: CanvasRenderingContext2D, ro: number) {
  const u = (value: number) => value * ro;
  const r = 0.075;
  ctx.beginPath();
  ctx.moveTo(u(-0.24 + r), u(-0.32));
  ctx.lineTo(u(0.03), u(-0.32));
  ctx.bezierCurveTo(u(0.15), u(-0.32), u(0.215), u(-0.25), u(0.215), u(-0.145));
  ctx.bezierCurveTo(u(0.215), u(-0.05), u(0.16), u(0.015), u(0.085), u(0.045));
  ctx.bezierCurveTo(u(0.19), u(0.065), u(0.265), u(0.14), u(0.265), u(0.245));
  ctx.bezierCurveTo(u(0.265), u(0.35), u(0.19), u(0.415), u(0.07), u(0.415));
  ctx.lineTo(u(-0.24 + r), u(0.415));
  ctx.quadraticCurveTo(u(-0.24), u(0.415), u(-0.24), u(0.415 - r));
  ctx.lineTo(u(-0.24), u(-0.32 + r));
  ctx.quadraticCurveTo(u(-0.24), u(-0.32), u(-0.24 + r), u(-0.32));
  ctx.closePath();
}

function emberGradient(ctx: CanvasRenderingContext2D, ro: number) {
  const fill = ctx.createLinearGradient(-ro, -ro, ro, ro);
  fill.addColorStop(0, '#ffab52');
  fill.addColorStop(0.42, '#f4661e');
  fill.addColorStop(1, '#a8290a');
  return fill;
}

/**
 * One half of the ring, revealed by a sweep from the top gap (`progress` 0–1). side -1 is the
 * left half, 1 the right. The rounded stroke softens its corners the way the logo's are.
 */
function drawRingHalf(ctx: CanvasRenderingContext2D, ro: number, side: -1 | 1, progress: number, scale: number) {
  if (progress <= 0) return;
  ctx.save();
  ctx.scale(side === -1 ? 1 : -1, 1);
  const sweep = Math.PI * 1.1 * progress;
  if (progress < 1) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, ro * 1.3, -Math.PI / 2 + 0.02, -Math.PI / 2 - sweep, true);
    ctx.closePath();
    ctx.clip();
  }
  const fill = emberGradient(ctx, ro);
  const half = ringHalf(ro);
  ctx.fillStyle = fill;
  ctx.fill(half);
  ctx.lineJoin = 'round';
  ctx.lineWidth = ro * 0.05;
  ctx.strokeStyle = fill;
  ctx.stroke(half);
  // A thin light along the outer edge, like the logo's glass rim.
  ctx.beginPath();
  ctx.arc(0, 0, ro * 0.985, -Math.PI * 0.56, -Math.PI * 0.98, true);
  ctx.strokeStyle = 'rgba(255, 226, 190, 0.38)';
  ctx.lineWidth = 1.2 / scale;
  ctx.stroke();
  ctx.restore();
  // The sweep's leading edge, while it is still drawing.
  if (progress > 0 && progress < 1) {
    const angle = -Math.PI / 2 - sweep;
    const dx = Math.cos(angle) * (side === -1 ? 1 : -1);
    const dy = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(dx * ro * (RING_INNER - 0.04), dy * ro * (RING_INNER - 0.04));
    ctx.lineTo(dx * ro * 1.06, dy * ro * 1.06);
    ctx.strokeStyle = `rgba(255, 214, 170, ${0.7 * (1 - progress)})`;
    ctx.lineWidth = 1 / scale;
    ctx.stroke();
  }
}

// ── the pen-tool curve ──────────────────────────────────────────────────────────────────────────
type Point = { x: number; y: number };
function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

export function startSplashArt(canvas: HTMLCanvasElement, options: Options): SplashArt {
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32((Date.now() ^ (performance.now() * 1000)) >>> 0);
  const between = (lo: number, hi: number) => lo + (hi - lo) * rand();

  // This launch's composition.
  const orbitStart = between(-2.4, -0.9);
  const dotStart = orbitStart + between(1.9, 2.6);
  const drift = [between(0, 6.28), between(0, 6.28), between(0, 6.28), between(0, 6.28)];
  const curveFlip = rand() < 0.5 ? 1 : -1;
  const RIBBONS = 30;
  const ribbonHues = ['#8f1d0a', '#c2300f', '#e2481a', '#f4661e', '#ff8a33', '#ffab52', '#ffc978'];
  const ribbons = Array.from({ length: RIBBONS }, (_, index) => {
    const roll = rand();
    const color = roll < 0.08 ? '#ffe9cc' : roll < 0.14 ? '#ff3d6e' : ribbonHues[Math.min(ribbonHues.length - 1, Math.floor((index / RIBBONS) * ribbonHues.length + between(-1, 1)))] ?? '#f4661e';
    return { color, spread: between(-1, 1), lag: between(0, 0.12), alpha: between(0.55, 1) };
  });

  // The attention grid.
  const ROWS = 6;
  const COLS = 22;
  const CELL = 4;
  const PITCH = 6;
  const cells = Array.from({ length: ROWS * COLS }, (_, index) => {
    const level = [0, 0, 0, 1, 1, 2, 2, 3, 4][Math.floor(rand() * 9)];
    return {
      row: index % ROWS,
      col: Math.floor(index / ROWS),
      level: 0,
      target: level,
      // Where it flies to in the finale: a point inside the ring, in the mark's own units.
      side: (rand() < 0.5 ? -1 : 1) as -1 | 1,
      angle: between(0.08, 0.92),
      depth: between(0.1, 0.9),
      delay: between(0, 0.1),
      bend: between(-0.35, 0.35),
    };
  });

  let W = 0;
  let H = 0;
  let dpr = 1;
  let dots: HTMLCanvasElement | null = null;
  /** The card, in canvas coordinates. */
  let box = { x: 0, y: 0, w: 1, h: 1 };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const card = options.card.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    box = { x: card.left - rect.left, y: card.top - rect.top, w: Math.max(1, card.width), h: Math.max(1, card.height) };
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    // The artboard's dot grid, drawn once per size.
    dots = document.createElement('canvas');
    dots.width = canvas.width;
    dots.height = canvas.height;
    const dctx = dots.getContext('2d')!;
    dctx.scale(dpr, dpr);
    dctx.fillStyle = INK(1);
    const step = 18;
    for (let x = box.x + box.w * SPLIT + step / 2; x < box.x + box.w; x += step) {
      for (let y = box.y + step / 2; y < box.y + box.h; y += step) dctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  observer.observe(options.card);

  const started = performance.now();
  let finaleAt: number | null = null;
  let leftAtFinish = 0;
  let opened = false;
  let covered = false;
  let done = false;
  let raf = 0;
  let last = started;

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t = options.reducedMotion ? 6 : (now - started) / 1000;
    const f = finaleAt == null ? -1 : (now - finaleAt) / 1000;
    draw(t, f, dt);
    if (!done) raf = requestAnimationFrame(frame);
  };

  function draw(t: number, f: number, dt: number) {
    const finale = f >= 0;
    const gather = finale ? clamp(f / GATHER) : 0;
    const settle = finale ? span(f, GATHER, SETTLE) : 0;
    const open = finale ? span(f, GATHER + SETTLE, OPEN) : 0;
    if (open > 0 && !opened) {
      opened = true;
      options.onOpen();
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);

    const split = box.x + box.w * SPLIT;
    const artW = box.x + box.w - split;
    const R = Math.min(artW, box.h) * 0.34;
    const roIdle = R * 0.618;
    const roFinal = Math.min(box.w, box.h) * 0.15;
    const move = easeInOut(clamp(f / (GATHER * 0.95)));
    const gx = lerp(split + artW / 2, box.x + box.w / 2, finale ? move : 0);
    const gy = box.y + box.h / 2;
    const k = lerp(1, roFinal / roIdle, finale ? move : 0);
    const construction = finale ? 1 - easeInOut(clamp(f / (GATHER * 0.8))) : 1;

    // ── the card, growing to fill the window in the finale ──
    const grow = finale ? easeInOut(span(f, EXPAND_AT, EXPAND)) : 0;
    if (grow >= 1 && !covered) {
      covered = true;
      options.onCovered();
    }
    const cardX = lerp(box.x, 0, grow);
    const cardY = lerp(box.y, 0, grow);
    const cardW = lerp(box.w, W, grow);
    const cardH = lerp(box.h, H, grow);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, RADIUS * (1 - grow));
    ctx.clip();

    // ── ground ──
    ctx.fillStyle = BG_ART;
    ctx.fillRect(cardX, cardY, cardW, cardH);
    const merge = finale ? easeInOut(clamp(f / 0.6)) : 0;
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, R * 1.7 * k);
    glow.addColorStop(0, `rgba(255, 110, 40, ${0.07 + 0.08 * settle})`);
    glow.addColorStop(1, 'rgba(255, 110, 40, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cardX, cardY, cardW, cardH);
    if (merge < 1) {
      ctx.globalAlpha = 1 - merge;
      ctx.fillStyle = BG_LEFT;
      ctx.fillRect(box.x, box.y, split - box.x, box.h);
      ctx.fillStyle = INK(0.07);
      ctx.fillRect(Math.round(split), box.y, 1, box.h);
      ctx.globalAlpha = 1;
    }
    // The card's hairline edge, gone by the time it fills the window.
    if (grow < 1) {
      ctx.strokeStyle = INK(0.1 * (1 - grow));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(cardX + 0.5, cardY + 0.5, cardW - 1, cardH - 1, Math.max(0, RADIUS * (1 - grow) - 0.5));
      ctx.stroke();
    }

    // The artboard dots, uncovered from the centre outwards.
    if (dots && construction > 0) {
      const reveal = easeOut(span(t, 0.1, 1.8)) * Math.hypot(artW, box.h);
      ctx.save();
      ctx.beginPath();
      ctx.arc(split + artW / 2, gy, reveal, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = 0.055 * construction;
      ctx.drawImage(dots, 0, 0, W, H);
      ctx.restore();
    }

    // ── the construction and the mark, around the group centre ──
    ctx.save();
    ctx.translate(gx, gy);
    ctx.scale(k, k);
    const hair = 1 / k;
    const spin = finale ? easeInOut(gather) * 0.5 : 0;

    if (construction > 0) {
      ctx.globalAlpha = construction;
      ctx.lineWidth = hair;

      // Guides through the centre.
      const guides = easeOut(span(t, 0.1, 1.3));
      ctx.strokeStyle = INK(0.075);
      ctx.beginPath();
      ctx.moveTo(-(artW / 2 - 18) * guides, 0);
      ctx.lineTo((artW / 2 - 18) * guides, 0);
      ctx.moveTo(0, -(box.h / 2 - 18) * guides);
      ctx.lineTo(0, (box.h / 2 - 18) * guides);
      ctx.stroke();

      // The unit circle and its protractor ticks.
      const circle = easeInOut(span(t, 0.15, 1.6));
      const turn = t * 0.012 + spin;
      ctx.strokeStyle = INK(0.2);
      ctx.beginPath();
      ctx.arc(0, 0, R, -Math.PI / 2 + turn, -Math.PI / 2 + turn + Math.PI * 2 * circle);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 72; i++) {
        if (i / 72 > circle) break;
        const angle = -Math.PI / 2 + turn + (i / 72) * Math.PI * 2;
        const long = i % 6 === 0;
        const inner = R - (long ? 9 : 4) * hair;
        ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
        ctx.lineTo(Math.cos(angle) * R, Math.sin(angle) * R);
      }
      ctx.strokeStyle = INK(0.18);
      ctx.stroke();

      // Golden guides: the ring's outer and inner edges.
      const golden = easeInOut(span(t, 0.35, 1.6));
      ctx.setLineDash([3 * hair, 5 * hair]);
      ctx.strokeStyle = INK(0.16);
      for (const [radius, from] of [[R * 0.618, -0.4], [R * 0.382, 2.2]] as const) {
        ctx.beginPath();
        ctx.arc(0, 0, radius, from - turn * 2, from - turn * 2 + Math.PI * 2 * golden);
        ctx.stroke();
      }
      // A far arc, turning slowly the other way.
      ctx.strokeStyle = INK(0.1);
      ctx.beginPath();
      const far = -t * 0.03 - spin;
      ctx.arc(0, 0, R * 1.3, far + 0.6, far + 0.6 + 2.3 * easeInOut(span(t, 0.6, 1.8)));
      ctx.stroke();
      ctx.setLineDash([]);

      // The orbit: a radius to a point on the circle, its tangent, and the angle it makes.
      const orbit = easeOut(span(t, 0.9, 1.2));
      const phi = orbitStart + t * 0.05 + spin;
      const ox = Math.cos(phi) * R;
      const oy = Math.sin(phi) * R;
      ctx.globalAlpha = construction * orbit;
      ctx.strokeStyle = INK(0.14);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(ox, oy);
      ctx.moveTo(ox - Math.sin(phi) * R * 0.75, oy + Math.cos(phi) * R * 0.75);
      ctx.lineTo(ox + Math.sin(phi) * R * 0.75, oy - Math.cos(phi) * R * 0.75);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ox, oy, R * 0.1, 0, Math.PI * 2);
      ctx.strokeStyle = INK(0.24);
      ctx.stroke();
      const theta = ((phi % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.2, 0, theta, false);
      ctx.strokeStyle = EMBER(0.5);
      ctx.stroke();
      // A solid ember disc riding the circle the other way.
      const psi = dotStart - t * 0.035 - spin;
      ctx.beginPath();
      ctx.arc(Math.cos(psi) * R, Math.sin(psi) * R, R * 0.032, 0, Math.PI * 2);
      ctx.fillStyle = EMBER(0.95);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(Math.cos(psi) * R, Math.sin(psi) * R, R * 0.065, 0, Math.PI * 2);
      ctx.strokeStyle = EMBER(0.35);
      ctx.stroke();

      // The pen-tool curve, its handles, and a few bits travelling along it.
      const draw = easeInOut(span(t, 0.6, 1.7));
      const p0 = { x: -R * 1.2, y: R * 0.98 * curveFlip };
      const p3 = { x: R * 1.08, y: -R * 0.92 * curveFlip };
      const c1 = { x: p0.x + R * 1.15 + Math.sin(t * 0.31 + drift[0]) * R * 0.12, y: p0.y - R * 0.08 * curveFlip + Math.cos(t * 0.23 + drift[1]) * R * 0.1 };
      const c2 = { x: p3.x - R * 1.35 + Math.sin(t * 0.27 + drift[2]) * R * 0.12, y: p3.y + R * 0.2 * curveFlip + Math.cos(t * 0.19 + drift[3]) * R * 0.1 };
      ctx.globalAlpha = construction;
      if (draw > 0) {
        const curve = ctx.createLinearGradient(p0.x, p0.y, p3.x, p3.y);
        curve.addColorStop(0, EMBER(0.15));
        curve.addColorStop(0.5, EMBER(0.9));
        curve.addColorStop(1, 'rgba(255, 196, 120, 0.5)');
        ctx.beginPath();
        const steps = 90;
        for (let i = 0; i <= steps * draw; i++) {
          const point = cubic(p0, c1, c2, p3, i / steps);
          if (i === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        }
        ctx.strokeStyle = curve;
        ctx.lineWidth = 1.4 * hair;
        ctx.stroke();
        ctx.lineWidth = hair;
      }
      const handles = easeOut(span(t, 1.2, 0.8));
      if (handles > 0) {
        ctx.globalAlpha = construction * handles;
        ctx.strokeStyle = INK(0.32);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(c1.x, c1.y);
        ctx.moveTo(p3.x, p3.y);
        ctx.lineTo(c2.x, c2.y);
        ctx.stroke();
        for (const handle of [c1, c2]) {
          ctx.beginPath();
          ctx.arc(handle.x, handle.y, 2.6 * hair, 0, Math.PI * 2);
          ctx.fillStyle = BG_ART;
          ctx.fill();
          ctx.strokeStyle = INK(0.6);
          ctx.stroke();
        }
        const size = 6 * hair;
        ctx.fillStyle = EMBER(1);
        ctx.fillRect(p0.x - size / 2, p0.y - size / 2, size, size);
        ctx.fillStyle = BG_ART;
        ctx.fillRect(p3.x - size / 2, p3.y - size / 2, size, size);
        ctx.strokeStyle = INK(0.7);
        ctx.strokeRect(p3.x - size / 2, p3.y - size / 2, size, size);
        for (let i = 0; i < 3; i++) {
          const u = (t * (0.045 + i * 0.012) + i * 0.33) % 1;
          const bit = cubic(p0, c1, c2, p3, u);
          ctx.globalAlpha = construction * handles * Math.sin(u * Math.PI);
          ctx.fillStyle = i === 1 ? 'rgba(255, 214, 170, 1)' : EMBER(1);
          const b = (i === 1 ? 3 : 2.2) * hair;
          ctx.fillRect(bit.x - b / 2, bit.y - b / 2, b, b);
        }
      }

      // Measurements, live.
      const labels = easeOut(span(t, 1.3, 0.9));
      if (labels > 0) {
        ctx.globalAlpha = construction * labels;
        ctx.font = `${9 * hair}px ${MONO}`;
        ctx.fillStyle = INK(0.38);
        ctx.textBaseline = 'middle';
        // A label beside its point, or on the point's other side when it would leave the window.
        const put = (x: number, y: number, text: string, dx = 8) => {
          const width = ctx.measureText(text).width;
          const right = gx + (x + dx * hair + width) * k > box.x + box.w - 12;
          ctx.fillText(text, right ? x - dx * hair - width : x + dx * hair, y);
        };
        const at = (radius: number, angle: number, text: string, dx = 8) => put(Math.cos(angle) * radius, Math.sin(angle) * radius, text, dx);
        at(R, -0.72 + turn, 'r 1.000');
        at(R * 0.618, -0.4 - turn * 2, 'r 0.618', 6);
        at(R * 1.3, far + 0.6, 'φ 1.618', 6);
        ctx.fillStyle = EMBER(0.7);
        ctx.fillText(`θ ${((theta * 180) / Math.PI).toFixed(1)}°`, Math.cos(theta / 2) * R * 0.2 + 6 * hair, Math.sin(theta / 2) * R * 0.2);
        ctx.fillStyle = INK(0.38);
        put(p3.x, p3.y - 12 * hair * curveFlip, `x ${Math.round(gx + p3.x * k)}  y ${Math.round(gy + p3.y * k)}`, 10);
        ctx.fillText(`${(Math.hypot(c1.x - p0.x, c1.y - p0.y) / R).toFixed(3)}`, (p0.x + c1.x) / 2, (p0.y + c1.y) / 2 + 12 * hair * curveFlip);
      }
      ctx.globalAlpha = 1;
    }

    // ── the mark ──
    const roLocal = roIdle;
    const leftNow = 0.8 * easeOut(span(t, 0.5, 2.8));
    const left = finale ? lerp(leftAtFinish, 1, easeInOut(clamp(f / (GATHER * 0.75)))) : leftNow;
    const right = finale ? easeInOut(span(f, 0.12, GATHER * 0.85)) : 0;
    const outline = (1 - right) * easeInOut(span(t, 0.4, 1.9));
    const solid = 1 - clamp(open / 0.14);

    if (open === 0) {
      // The right half is still a drawing: its outline only.
      if (outline > 0.01) {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.setLineDash([2 * hair, 4 * hair]);
        ctx.lineWidth = hair;
        ctx.strokeStyle = INK(0.3 * outline);
        ctx.stroke(ringHalf(roLocal));
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
    if (solid > 0) {
      ctx.globalAlpha = solid;
      drawRingHalf(ctx, roLocal, -1, left, k);
      drawRingHalf(ctx, roLocal, 1, right, k);
      // A sheen across the finished ring.
      if (settle > 0 && settle < 1) drawSheen(roLocal, settle);
      ctx.globalAlpha = 1;
    }

    // The B arrives once the ring is whole.
    const bIn = finale ? span(f, GATHER * 0.7, SETTLE + 0.2) : 0;
    const bOut = 1 - clamp(open / 0.3);
    if (bIn > 0 && bOut > 0) {
      const s = lerp(0.55, 1, easeOutBack(bIn)) * (1 + open * 1.6);
      ctx.save();
      ctx.globalAlpha = clamp(bIn * 2) * bOut;
      ctx.scale(s, s);
      bPath(ctx, roLocal);
      const fill = emberGradient(ctx, roLocal * 0.5);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.lineWidth = roLocal * 0.03;
      ctx.strokeStyle = fill;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // ── the attention grid (screen space) ──
    drawGrid(t, f, dt, { split, artW, bottom: box.y + box.h, gx, gy, k, roLocal, construction });

    // ── the push through the ring ──
    if (open > 0) {
      const diag = Math.hypot(W, H);
      const ri = roLocal * RING_INNER * k;
      const zoomMax = (diag / ri) * 1.25;
      const zoom = Math.pow(zoomMax, easeInOutSine(open));
      // The ring's hole opens onto the app.
      const hole = ri * zoom * easeOut(clamp(open / 0.28)) * 0.97;
      if (hole > 0.5) {
        ctx.globalCompositeOperation = 'destination-out';
        const feather = ctx.createRadialGradient(gx, gy, hole * 0.82, gx, gy, hole);
        feather.addColorStop(0, 'rgba(0, 0, 0, 1)');
        feather.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = feather;
        ctx.beginPath();
        ctx.arc(gx, gy, hole, 0, Math.PI * 2);
        ctx.fill();
      }
      // The ring, as ribbons of light parting as they rush past.
      ctx.globalCompositeOperation = 'lighter';
      const part = open * open;
      const fade = clamp(open / 0.08) * (1 - smooth(0.62, 1, open));
      ctx.save();
      ctx.translate(gx, gy);
      ctx.scale(k * zoom, k * zoom);
      const thickness = roLocal * (1 - RING_INNER);
      ribbons.forEach((ribbon, index) => {
        const base = roLocal * RING_INNER + thickness * ((index + 0.5) / RIBBONS);
        const radius = base * (1 + ribbon.spread * 0.55 * clamp(part - ribbon.lag));
        const width = (thickness / RIBBONS) * 1.15 * lerp(1, 0.14, clamp(open * 1.4));
        const angles = cutAngles(radius, roLocal);
        ctx.globalAlpha = fade * ribbon.alpha;
        ctx.strokeStyle = ribbon.color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.arc(0, 0, radius, angles.top, angles.bottom, true);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, radius, Math.PI - angles.top, Math.PI - angles.bottom, false);
        ctx.stroke();
      });
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      if (open >= 1 && !done) {
        done = true;
        ctx.clearRect(0, 0, W, H);
        options.onDone();
      }
    }
    // The card's clip.
    ctx.restore();
  }

  function drawSheen(ro: number, progress: number) {
    ctx.save();
    ctx.clip(ringWhole(ro));
    const x = lerp(-ro * 1.6, ro * 1.6, easeInOut(progress));
    const band = ctx.createLinearGradient(x - ro * 0.35, -ro, x + ro * 0.35, ro);
    band.addColorStop(0, 'rgba(255, 236, 210, 0)');
    band.addColorStop(0.5, `rgba(255, 236, 210, ${0.4 * Math.sin(progress * Math.PI)})`);
    band.addColorStop(1, 'rgba(255, 236, 210, 0)');
    ctx.fillStyle = band;
    ctx.fillRect(-ro * 1.2, -ro * 1.2, ro * 2.4, ro * 2.4);
    ctx.restore();
  }

  function drawGrid(t: number, f: number, dt: number, place: { split: number; artW: number; bottom: number; gx: number; gy: number; k: number; roLocal: number; construction: number }) {
    const pad = Math.max(24, place.artW * 0.06);
    const gridH = ROWS * PITCH - (PITCH - CELL);
    const x0 = place.split + pad;
    const y0 = place.bottom - pad - gridH;
    const finale = f >= 0;

    // A few cells change their mind every second; a slow column of attention sweeps across.
    if (!options.reducedMotion && rand() < dt * 7) {
      const cell = cells[Math.floor(rand() * cells.length)];
      cell.target = [0, 0, 1, 1, 2, 3, 4][Math.floor(rand() * 7)];
    }
    const sweep = (t * 2.2) % (COLS + 10);

    ctx.font = `9px ${MONO}`;
    ctx.textBaseline = 'alphabetic';
    const caption = easeOut(span(t, 1.1, 0.8)) * place.construction;
    if (caption > 0) {
      ctx.globalAlpha = caption;
      ctx.fillStyle = INK(0.3);
      ctx.fillText(`fig. 2 — attention · ${ROWS} × ${COLS}`, x0, y0 - 9);
    }

    for (const cell of cells) {
      cell.level += (cell.target - cell.level) * Math.min(1, dt * 3.5);
      const appear = easeOut(span(t, 0.8 + cell.col * 0.028 + cell.row * 0.035, 0.35));
      if (appear <= 0) continue;
      const cx = x0 + cell.col * PITCH;
      const cy = y0 + cell.row * PITCH;
      const near = Math.max(0, 1 - Math.abs(cell.col - sweep) / 2.5);
      const lit = clamp(cell.level / 4 + near * 0.25);

      if (!finale || cell.level < 1.2) {
        const fadeAway = finale ? 1 - clamp(f / 0.4) : 1;
        if (fadeAway <= 0) continue;
        ctx.globalAlpha = appear * fadeAway;
        ctx.fillStyle = cell.level < 0.5 && near < 0.2 ? INK(0.07) : lit > 0.85 ? `rgba(255, 176, 96, ${0.25 + lit * 0.7})` : EMBER(0.12 + lit * 0.8);
        ctx.fillRect(cx, cy, CELL, CELL);
        continue;
      }

      // The finale: lit cells fly into the ring along a bent path, trailing light.
      const u = clamp((f - cell.col * 0.012 - cell.delay) / 0.55);
      if (u >= 1) continue;
      const halfSpan = cutAngles(place.roLocal, place.roLocal);
      const along = lerp(halfSpan.top, halfSpan.bottom + (halfSpan.bottom < halfSpan.top ? 0 : -Math.PI * 2), cell.angle);
      const radius = place.roLocal * lerp(RING_INNER, 1, cell.depth);
      const lx = Math.cos(along) * radius * (cell.side === -1 ? 1 : -1);
      const ly = Math.sin(along) * radius;
      const tx = place.gx + lx * place.k;
      const ty = place.gy + ly * place.k;
      const sx = cx + CELL / 2;
      const sy = cy + CELL / 2;
      const mx = (sx + tx) / 2 + (ty - sy) * cell.bend;
      const my = (sy + ty) / 2 - (tx - sx) * cell.bend;
      ctx.globalCompositeOperation = 'lighter';
      for (let trail = 4; trail >= 0; trail--) {
        const e = easeInOut(clamp(u - trail * 0.035));
        const px = (1 - e) * (1 - e) * sx + 2 * (1 - e) * e * mx + e * e * tx;
        const py = (1 - e) * (1 - e) * sy + 2 * (1 - e) * e * my + e * e * ty;
        const size = lerp(CELL, 2, e) * (1 - trail * 0.15);
        ctx.globalAlpha = (1 - trail / 5) * (1 - smooth(0.8, 1, u)) * 0.9;
        ctx.fillStyle = trail === 0 ? 'rgba(255, 214, 170, 1)' : EMBER(1);
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  raf = requestAnimationFrame(frame);

  return {
    finish() {
      if (finaleAt != null) return;
      if (options.reducedMotion) {
        done = true;
        options.onOpen();
        options.onCovered();
        options.onDone();
        return;
      }
      const t = (performance.now() - started) / 1000;
      leftAtFinish = 0.8 * easeOut(span(t, 0.5, 2.8));
      finaleAt = performance.now();
    },
    destroy() {
      done = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
    },
  };
}
