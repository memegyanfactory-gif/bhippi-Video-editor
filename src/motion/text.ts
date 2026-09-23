// Text layout and per-glyph animation for text layers. Pure: the host injects a `measure`
// function (canvas measureText in the browser, a fixed advance in tests). The GL executor
// rasterises the result with Canvas2D, one glyph at a time, so each glyph can carry its own
// offset, scale, rotation, opacity, blur and colour — AE's text animators.
import { ease, num, vec, type ExprContext } from './anim';
import { hash01 } from './expr';
import type { TextAnimator, TextLayerData, TextSpan } from './types';

export type Measure = (text: string, font: string) => number;

export const DEFAULT_FONT = '"Inter", "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
export const SCRIPT_FONT = '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive';

type Styled = { ch: string; font: string; family: string; weight: number; italic: boolean; size: number; color: string; tracking: number; span: number };

export type GlyphState = {
  ch: string;
  font: string;
  color: string;
  /** Glyph origin (left, baseline) in layer pixels, before animation. */
  x: number;
  y: number;
  advance: number;
  size: number;
  /** Animated deltas. */
  dx: number;
  dy: number;
  scale: number;
  rotation: number;
  opacity: number;
  blur: number;
  skew: number;
  char: number;
  word: number;
  line: number;
};

export type StrikeState = { x0: number; x1: number; y: number; progress: number; color: string; thickness: number; opacity: number };

export type TextFrame = { width: number; height: number; glyphs: GlyphState[]; strikes: StrikeState[]; pad: number };

const SERIF = /georgia|garamond|times|cambria|palatino|serif|playfair|merriweather|lora|baskerville/i;
const MONO = /mono|code|consol|courier/i;
/**
 * A single family name becomes a stack with a fallback of the same kind, so a font the machine lacks
 * falls back to a sans (or serif / mono) instead of the canvas default serif. Stacks pass through.
 */
export function familyStack(family: string): string {
  if (family.includes(',')) return family;
  const name = family.replace(/^["']|["']$/g, '').trim();
  if (!name) return DEFAULT_FONT;
  const quoted = `"${name}"`;
  if (MONO.test(name)) return `${quoted}, "Cascadia Code", Consolas, monospace`;
  if (SERIF.test(name) && !/sans/i.test(name)) return `${quoted}, Georgia, "Times New Roman", serif`;
  return `${quoted}, "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`;
}

export const fontString = (family: string, size: number, weight: number, italic: boolean) => `${italic ? 'italic ' : ''}${weight} ${Math.max(1, size).toFixed(2)}px ${familyStack(family)}`;

function formatCounter(value: number, decimals: number, separator: string, format: string): string {
  const fixed = Math.abs(value).toFixed(Math.max(0, decimals));
  const [intPart, frac] = fixed.split('.');
  const grouped = separator ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, separator) : intPart;
  const n = `${value < 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
  return format.includes('{n}') ? format.replace('{n}', n) : `${n}${format}`;
}

function styledChars(data: TextLayerData, t: number, ctx: ExprContext): Styled[] {
  const baseSize = num(data.size, t, 96, ctx);
  const baseFamily = data.font ?? DEFAULT_FONT;
  const base = { family: baseFamily, weight: data.weight ?? 700, italic: !!data.italic, size: baseSize, color: data.color ?? '#ffffff', tracking: data.tracking ?? 0 };
  let spans: TextSpan[];
  if (data.counter) {
    const value = num(data.counter.value, t, 0, ctx);
    spans = [{ text: formatCounter(value, data.counter.decimals ?? 0, data.counter.separator ?? ',', data.counter.format ?? '{n}') }];
  } else spans = data.spans?.length ? data.spans : [{ text: data.text ?? '' }];
  const out: Styled[] = [];
  spans.forEach((span, index) => {
    const family = span.font === 'script' ? SCRIPT_FONT : span.font ?? base.family;
    const weight = span.weight ?? (span.font === 'script' ? 400 : base.weight);
    const italic = span.italic ?? base.italic;
    const size = span.size ?? (span.font === 'script' ? base.size * 1.1 : base.size);
    for (const ch of Array.from(span.text)) {
      out.push({ ch, font: fontString(family, size, weight, italic), family, weight, italic, size, color: span.color ?? base.color, tracking: span.tracking ?? base.tracking, span: index });
    }
  });
  return out;
}

type Placed = Styled & { x: number; line: number; advance: number };

/** Lays text out into lines; x is relative to the line start. */
function layoutLines(chars: Styled[], measure: Measure, box: number | undefined): Placed[][] {
  const lines: Placed[][] = [[]];
  // Advances by prefix measurement inside runs of one style, so kerning pairs survive.
  const advances: number[] = new Array(chars.length).fill(0);
  let runStart = 0;
  for (let i = 1; i <= chars.length; i++) {
    if (i === chars.length || chars[i].font !== chars[runStart].font || chars[i].ch === '\n') {
      let previous = 0;
      let text = '';
      for (let j = runStart; j < i; j++) {
        if (chars[j].ch === '\n') { advances[j] = 0; continue; }
        text += chars[j].ch;
        const width = measure(text, chars[j].font);
        advances[j] = width - previous;
        previous = width;
      }
      runStart = i;
    }
  }
  let x = 0;
  let wordStart = 0; // index into the current line where the current word starts
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c.ch === '\n') { lines.push([]); x = 0; wordStart = 0; continue; }
    const line = lines[lines.length - 1];
    const advance = advances[i] + c.tracking * (c.size / 1000) * 10;
    if (c.ch === ' ') wordStart = line.length + 1;
    if (box && x + advance > box && c.ch !== ' ' && wordStart > 0) {
      // Move the current word to a new line.
      const moved = line.splice(wordStart);
      const next: Placed[] = [];
      let nx = 0;
      for (const m of moved) { next.push({ ...m, x: nx }); nx += m.advance; }
      while (line.length && line[line.length - 1].ch === ' ') line.pop();
      lines.push(next);
      x = nx;
      wordStart = 0;
    }
    const current = lines[lines.length - 1];
    current.push({ ...c, x, line: 0, advance });
    x += advance;
  }
  return lines;
}

/** Amount 0..1 a range selector gives unit `i` of `count`. */
export function rangeAmount(animator: TextAnimator, i: number, count: number, t: number, ctx: ExprContext): number {
  const start = num(animator.start, t, 0, ctx);
  const end = num(animator.end, t, 100, ctx);
  const offset = num(animator.offset, t, 0, ctx);
  const s = ((start + offset) / 100) * count;
  const e = ((end + offset) / 100) * count;
  const lo = Math.min(s, e);
  const hi = Math.max(s, e);
  let index = i;
  if (animator.randomize) {
    const order = Array.from({ length: count }, (_, k) => k).sort((a, b) => hash01(a * 13.7 + (animator.seed ?? 1)) - hash01(b * 13.7 + (animator.seed ?? 1)));
    index = order.indexOf(i);
  }
  const c = index + 0.5;
  const soft = Math.max(1e-3, animator.smoothness ?? 0.001);
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  switch (animator.shape ?? 'square') {
    case 'ramp-up': return hi - lo < 1e-6 ? (c >= hi ? 1 : 0) : clamp01((c - lo) / (hi - lo));
    case 'ramp-down': return hi - lo < 1e-6 ? (c < lo ? 1 : 0) : clamp01((hi - c) / (hi - lo));
    case 'triangle': { const mid = (lo + hi) / 2; const half = Math.max(1e-6, (hi - lo) / 2); return clamp01(1 - Math.abs(c - mid) / half); }
    case 'round': { const mid = (lo + hi) / 2; const half = Math.max(1e-6, (hi - lo) / 2); const d = (c - mid) / half; return d * d >= 1 ? 0 : Math.sqrt(1 - d * d); }
    case 'smooth': { const a = clamp01((c - lo) / soft + 0.5); const b = clamp01((hi - c) / soft + 0.5); return ease('ease-in-out', a) * ease('ease-in-out', b); }
    default: return clamp01((c - lo) / soft + 0.5) * clamp01((hi - c) / soft + 0.5);
  }
}

const mixHex = (a: string, b: string, t: number): string => {
  const parse = (hex: string) => {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
    return [0, 2, 4].map((k) => parseInt(full.slice(k, k + 2), 16) || 0);
  };
  const pa = parse(a);
  const pb = parse(b);
  const m = pa.map((v, k) => Math.round(v + (pb[k] - v) * Math.min(1, Math.max(0, t))));
  return `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

/** The text layer at scene time `t`: layout, then cascade, animators, reveal and strikes. */
export function layoutText(data: TextLayerData, t: number, measure: Measure, ctx: ExprContext = { seed: 1 }): TextFrame {
  const chars = styledChars(data, t, ctx);
  const lines = layoutLines(chars, measure, data.box);
  const lineHeightMul = data.lineHeight ?? 1.12;
  const lineSizes = lines.map((line) => Math.max(...line.map((c) => c.size), num(data.size, t, 96, ctx)));
  const lineWidths = lines.map((line) => (line.length ? line[line.length - 1].x + line[line.length - 1].advance : 0));
  const blockWidth = Math.max(data.box ?? 0, ...lineWidths, 1);
  const maxSize = Math.max(...lineSizes, 1);
  // Static padding: descenders, shadow, stroke. Room for the animation at *this* moment (blur,
  // offsets, growth) is added after the glyphs are animated, so settled text has a tight box.
  const basePad = Math.ceil(maxSize * 0.35 + (data.shadow ? data.shadow.blur * 2 + Math.abs(data.shadow.x ?? 0) + Math.abs(data.shadow.y ?? 0) : 0) + (data.stroke?.width ?? 0));
  const pad = basePad;
  const glyphs: GlyphState[] = [];
  let y = pad;
  let charIndex = 0;
  let wordIndex = -1;
  let inWord = false;
  lines.forEach((line, lineIndex) => {
    const size = lineSizes[lineIndex];
    y += size * 0.86; // ascent
    const width = lineWidths[lineIndex];
    const align = data.align ?? 'center';
    const offset = align === 'left' ? 0 : align === 'right' ? blockWidth - width : (blockWidth - width) / 2;
    for (const c of line) {
      if (c.ch === ' ') inWord = false;
      else if (!inWord) { inWord = true; wordIndex++; }
      glyphs.push({ ch: c.ch, font: c.font, color: c.color, x: pad + offset + c.x, y, advance: c.advance, size: c.size, dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1, blur: 0, skew: 0, char: charIndex++, word: Math.max(0, wordIndex), line: lineIndex });
    }
    inWord = false;
    y += size * (lineHeightMul - 0.86);
  });
  const height = y + pad - maxSize * (lineHeightMul - 1) * 0.5;
  const counts = { char: glyphs.length, word: wordIndex + 1, line: lines.length };
  const unitOf = (g: GlyphState, by: 'char' | 'word' | 'line') => (by === 'char' ? g.char : by === 'word' ? g.word : g.line);

  // Cascade: timed entrance (and exit) per unit.
  const cascade = data.cascade;
  if (cascade) {
    const n = counts[cascade.by];
    const times = Array.from({ length: n }, (_, u) => cascade.times?.[u] ?? (cascade.delay ?? 0) + u * (cascade.stagger ?? 0.06));
    const duration = Math.max(1e-3, cascade.duration ?? 0.5);
    for (const g of glyphs) {
      const u = unitOf(g, cascade.by);
      const p = ease(cascade.ease ?? 'expo-out', (t - times[u]) / duration);
      const from = cascade.from;
      const q = 1 - p;
      g.dx += (from.position?.[0] ?? 0) * q;
      g.dy += (from.position?.[1] ?? 0) * q;
      g.scale *= 1 + ((from.scale ?? 100) / 100 - 1) * q;
      g.rotation += (from.rotation ?? 0) * q;
      g.opacity *= (from.opacity ?? 0) / 100 + (1 - (from.opacity ?? 0) / 100) * p;
      g.blur += (from.blur ?? 0) * q;
      if (from.tracking) g.dx += from.tracking * q * (g.char - glyphs.findIndex((o) => unitOf(o, cascade.by) === u));
      if (cascade.dimTo !== undefined) {
        const bright = ease('ease-out', (t - times[u] - (cascade.brightenAfter ?? 0.25)) / 0.3);
        g.opacity *= cascade.dimTo + (1 - cascade.dimTo) * bright;
      }
      if (cascade.exit) {
        const exit = cascade.exit;
        const e = ease(exit.ease ?? 'cubic-in', (t - exit.at - u * (exit.stagger ?? 0)) / Math.max(1e-3, exit.duration ?? 0.35));
        g.dx += (exit.to.position?.[0] ?? 0) * e;
        g.dy += (exit.to.position?.[1] ?? 0) * e;
        g.scale *= 1 + ((exit.to.scale ?? 100) / 100 - 1) * e;
        g.opacity *= 1 - (1 - (exit.to.opacity ?? 0) / 100) * e;
        g.blur += (exit.to.blur ?? 0) * e;
      }
    }
  }

  // Animators with range selectors.
  for (const animator of data.animators ?? []) {
    const by = animator.by ?? 'char';
    const n = counts[by];
    const props = animator.props;
    const position = vec(props.position, t, [0, 0], ctx);
    const scale = props.scale === undefined ? 100 : num(props.scale, t, 100, ctx);
    const rotation = num(props.rotation, t, 0, ctx);
    const opacity = props.opacity === undefined ? 100 : num(props.opacity, t, 100, ctx);
    const blurValue = num(props.blur, t, 0, ctx);
    const tracking = num(props.tracking, t, 0, ctx);
    const skew = num(props.skew, t, 0, ctx);
    const fillAmount = props.fillColor ? num(props.fillAmount, t, 100, ctx) / 100 : 0;
    let trackShift = 0;
    for (const g of glyphs) {
      const amount = rangeAmount(animator, unitOf(g, by), n, t, ctx);
      g.dx += position[0] * amount + trackShift;
      g.dy += (position[1] ?? 0) * amount;
      g.scale *= 1 + (scale / 100 - 1) * amount;
      g.rotation += rotation * amount;
      g.opacity *= 1 + (opacity / 100 - 1) * amount;
      g.blur += blurValue * amount;
      g.skew += skew * amount;
      if (props.fillColor && amount > 0) g.color = mixHex(g.color, props.fillColor, amount * fillAmount);
      trackShift += tracking * amount;
    }
  }

  // Typewriter reveal.
  if (data.reveal !== undefined) {
    const visible = num(data.reveal, t, 1, ctx) * glyphs.length;
    for (const g of glyphs) g.opacity *= Math.min(1, Math.max(0, visible - g.char));
  }

  // Strike-throughs on spans.
  const strikes: StrikeState[] = [];
  data.spans?.forEach((span, index) => {
    if (!span.strike) return;
    let spanStart = 0;
    for (let k = 0; k < index; k++) spanStart += Array.from(data.spans![k].text).filter((ch) => ch !== '\n').length;
    const count = Array.from(span.text).filter((ch) => ch !== '\n').length;
    const members = glyphs.slice(spanStart, spanStart + count).filter((g) => g.ch !== ' ');
    if (!members.length) return;
    const progress = ease('expo-out', (t - span.strike.at) / Math.max(1e-3, span.strike.duration ?? 0.35));
    if (progress <= 0) return;
    const first = members[0];
    const last = members[members.length - 1];
    // The line fades with its words (a struck phrase that blurs out takes its strike with it).
    const opacity = members.reduce((sum, g) => sum + g.opacity, 0) / members.length;
    strikes.push({ x0: first.x + first.dx, x1: last.x + last.dx + last.advance, y: first.y - first.size * 0.3, progress, color: span.strike.color ?? '#ff2a4a', thickness: Math.max(2, first.size * 0.07), opacity });
  });

  let extra = 0;
  for (const g of glyphs) {
    if (g.opacity <= 0.002) continue;
    extra = Math.max(extra, g.blur * 3 + Math.max(Math.abs(g.dx), Math.abs(g.dy)) + g.size * Math.max(0, g.scale - 1) * 0.6 + (g.rotation || g.skew ? g.size * 0.3 : 0));
  }
  extra = Math.ceil(extra);
  if (extra > 0) {
    for (const g of glyphs) { g.x += extra; g.y += extra; }
    for (const k of strikes) { k.x0 += extra; k.x1 += extra; k.y += extra; }
  }
  return { width: Math.ceil(blockWidth + (pad + extra) * 2), height: Math.ceil(height + extra * 2), glyphs, strikes, pad: pad + extra };
}
