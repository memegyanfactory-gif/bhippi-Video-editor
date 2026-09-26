// Drawn-style templates (docs/DRAWN-STYLES.md): the hand-made films as one call each. Every
// template is a `drawing` layer (or a few), so the AI can read the scene back and edit any item,
// and every timing is the one measured on the reference films (24 fps, 2 f = one drawing on twos).
import { keys } from '../anim';
import type { DrawItem, DrawingData, Face } from '../ink/types';
import { FELT_GROUNDS, SKETCH_GROUNDS, WORLDS, WORD_ICONS, WORD_MOTIFS, inkSet, worldItems } from '../ink/library';
import type { Layer, MotionScene, Vec } from '../types';
import type { TemplateSpec } from './index';
import { scene, type KitContext } from './common';

const F = 1 / 24;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === 'string' && v ? v : d);
const list = <T>(v: unknown, d: T[]): T[] => (Array.isArray(v) && v.length ? (v as T[]) : d);

const drawing = (id: string, name: string, data: DrawingData, extra: Partial<Layer> = {}): Layer => ({ id, name, type: 'drawing', drawing: data, ...extra } as Layer);

/** Riso inks from a set name or an explicit list. */
function inksOf(value: unknown): { inks: string[]; paper: string } {
  if (Array.isArray(value) && value.length && value.every((c) => typeof c === 'string')) return { inks: (value as string[]).slice(0, 4), paper: inkSet('classic').paper };
  const set = inkSet(value);
  return { inks: set.inks, paper: set.paper };
}

const dotLayer = (W: number, H: number, color = '#3b2f8f', extra: Partial<Layer> = {}): Layer =>
  drawing('dot', 'Centre dot', { look: 'flat', items: [{ kind: 'circle', at: [W / 2, H / 2], size: Math.min(W, H) * 0.028, fill: color, stroke: null }] }, extra);

// ───────────────────────── riso ─────────────────────────

function risoWorld(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  const { width: W, height: H } = ctx;
  const seconds = num(p.seconds, 3);
  const { inks, paper } = inksOf(p.inks);
  const items = [...worldItems(str(p.world, 'sunrise'), W, H), ...list<DrawItem>(p.items, [])];
  const layers: Layer[] = [drawing('world', `World: ${str(p.world, 'sunrise')}`, { look: 'riso', inks, paper, misregister: num(p.misregister, 3), items })];
  if (p.dot !== false) layers.push(dotLayer(W, H, inks[inks.length - 1]));
  return scene(ctx, seconds, layers, { background: paper });
}

function risoRippleOpen(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  // Film 1 opening: rings grow out of the dot every 4 f; at openAt a world opens out of the dot in
  // 4 f, holds, and closes back into it in 3 f (mode disc) — or opens to the whole frame (full).
  const { width: W, height: H } = ctx;
  const m = Math.min(W, H);
  const { inks, paper } = inksOf(p.inks);
  const openAt = num(p.openAt, 1.5);
  const full = p.mode === 'full';
  const hold = num(p.hold, 0.3);
  const seconds = num(p.seconds, full ? openAt + 1.5 : openAt + 0.17 + hold + 0.13 + 1);
  const dot = 16;
  const disc = full ? Math.hypot(W, H) * 1.05 : m * 0.38;
  const box = (d: number): Vec => [W / 2 - d / 2, H / 2 - d / 2, d, d];
  const openEnd = openAt + 4 * F;
  const closeAt = openEnd + hold;
  const maskBox = full
    ? keys<Vec>([openAt, box(dot), 'expo-out'], [openEnd + 2 * F, box(disc)])
    : keys<Vec>([openAt, box(dot), 'expo-out'], [openEnd, box(disc)], [closeAt, box(disc), 'expo-in'], [closeAt + 3 * F, box(dot)]);
  const layers: Layer[] = [
    drawing('rings', 'Ripple rings', { look: 'riso', inks, paper, items: [{ kind: 'ripples', at: [W / 2, H / 2], size: m * 1.1, stroke: inks[0], period: 4 * F, life: 0.9, start: 0, fill: null }] }),
    drawing('world', `World: ${str(p.world, 'pond')}`, { look: 'riso', inks, paper, items: worldItems(str(p.world, 'pond'), W, H, openAt) }, {
      in: openAt, ...(full ? {} : { out: closeAt + 3 * F }), masks: [{ shape: 'ellipse', box: maskBox, feather: 1 }],
    }),
    dotLayer(W, H, inks[inks.length - 1]),
  ];
  return scene(ctx, seconds, layers, { background: paper, cues: [{ at: 0, sound: 'shimmer' }, { at: openAt, sound: 'pop' }, ...(full ? [] : [{ at: closeAt, sound: 'pop' as const }])] });
}

function risoMontage(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  // Film 1's middle: worlds cut under a fixed centre dot, holding 12 f, then 6, then 3 (it
  // accelerates); with swap, the same worlds come back re-inked with a ring pulsing round the dot.
  const { width: W, height: H } = ctx;
  const worlds = list<string>(p.worlds, WORLDS.filter((w) => w !== 'orbit'));
  const holds = list<number>(p.holds, [12, 12, 6, 6, 6, 6, 3, 3, 3, 3, 3, 3]);
  const first = inksOf(p.inks);
  const second = inksOf(p.swapInks ?? 'duotone');
  const passes = p.swap === false ? 1 : 2;
  const layers: Layer[] = [];
  let t = 0;
  let shot = 0;
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < worlds.length; i++, shot++) {
      const dur = holds[Math.min(shot, holds.length - 1)] * F;
      const ink = pass ? second : first;
      layers.push(drawing(`w${shot}`, `${worlds[i]}${pass ? ' (re-inked)' : ''}`, { look: 'riso', inks: ink.inks, paper: ink.paper, items: worldItems(worlds[i], W, H, t) }, { in: t, out: t + dur }));
      t += dur;
    }
  }
  const swapAt = passes > 1 ? layers[worlds.length].in ?? 0 : t;
  if (passes > 1) layers.push(drawing('ring', 'Pulse ring', { look: 'flat', items: [{ kind: 'ripples', at: [W / 2, H / 2], size: Math.min(W, H) * 0.5, stroke: '#ffffff', period: 0.25, life: 0.5, start: swapAt, fill: null }] }, { in: swapAt, out: t }));
  layers.push(dotLayer(W, H, first.inks[first.inks.length - 1]));
  return scene(ctx, Math.max(0.5, t), layers, { background: first.paper, cues: layers.filter((l) => l.id.startsWith('w')).map((l) => ({ at: l.in ?? 0, sound: 'tick' as const })) });
}

// ───────────────────────── the pen draws ─────────────────────────

function subjectItem(value: unknown, color: string, size: number, at: Vec): DrawItem {
  if (value && typeof value === 'object' && typeof (value as { d?: unknown }).d === 'string') return { id: 'subject', kind: 'path', d: (value as { d: string }).d, at, size, fill: color };
  const name = str(value, 'bot');
  if (name === 'bot') return { id: 'subject', kind: 'bot', at, size, fill: color };
  if (['sprite', 'flower', 'tree', 'sun', 'moon', 'cloud', 'heart', 'planet', 'star', 'blob'].includes(name)) return { id: 'subject', kind: name as DrawItem['kind'], at, size, fill: color };
  return { id: 'subject', kind: 'icon', icon: name, at, size, fill: color, stroke: '#2a2733' };
}

function penDraws(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  // Film 4: construction lines on graph paper; the nib outlines the subject stroke by stroke and
  // the pen follows the tip; crayon hatching sweeps the fill in; the eyes go in; a sparkle pops.
  const { width: W, height: H } = ctx;
  const m = Math.min(W, H);
  const drawFor = num(p.drawFor, 1.6);
  const look = (['crayon', 'ink', 'pencil'] as const).find((l) => l === p.look) ?? 'crayon';
  const color = str(p.color, '#ec8452');
  const title = typeof p.title === 'string' ? p.title : '';
  const done = 0.2 + drawFor;
  const fillEnd = done + 8 * F;
  const sparkleAt = fillEnd + 6 * F;
  const titleAt = sparkleAt + 8 * F;
  const titleLen = [...title.replace(/\n/g, '')].length / 12;
  const seconds = num(p.seconds, titleAt + titleLen + 1.2);
  const center: Vec = [W / 2, H * (title ? 0.5 : 0.55)];
  const subject = subjectItem(p.subject, color, m * 0.46, center);
  subject.draw = keys([0.2, 0, 'sine-in-out'], [done, 1]);
  subject.fillIn = keys([done, 0], [fillEnd, 1]);
  if (subject.kind === 'bot' || subject.kind === 'sprite') subject.faces = list<{ t: number; face: Face }>(p.faces, [{ t: 0, face: 'closed' }, { t: fillEnd, face: 'dots' }, { t: sparkleAt + 4 * F, face: 'happy' }]);
  const items: DrawItem[] = [
    { kind: 'construction', at: [W / 2, H / 2], size: [W, H], opacity: keys([0, 100], [done, 100], [fillEnd + 0.3, 0]) },
    subject,
    { kind: 'sparkle', at: [center[0], center[1] - m * 0.31], size: m * 0.13, pop: sparkleAt },
  ];
  if (title) items.push({ id: 'title', kind: 'write', text: title, at: [W / 2, H * 0.84], fontSize: m * 0.09, fill: '#2a2733', from: titleAt });
  items.push({ kind: 'pen', tool: (['nib', 'pencil', 'brush', 'crayon'] as const).find((t) => t === p.tool) ?? 'nib', follow: title ? ['subject', 'title'] : ['subject'], rest: [W * 0.84, H * 0.3] });
  const data: DrawingData = { look, paper: str(p.paper, '#f2ecdf'), step: 2, boil: num(p.boil, 1.1), items };
  return scene(ctx, seconds, [drawing('page', 'The pen draws', data)], { background: data.paper, cues: [{ at: 0.2, sound: 'key' }, { at: done, sound: 'swish' }, { at: sparkleAt, sound: 'glass' }, ...(title ? [{ at: titleAt, sound: 'typing' as const, duration: titleLen }] : [])] });
}

function sketchbook(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  // Film 4's generative montage: each motif drawn by the nib on its own felt ground, then cut.
  const { width: W, height: H } = ctx;
  const m = Math.min(W, H);
  const motifs = list<string>(p.motifs, ['rose', 'spiral', 'snowflake', 'web', 'lissajous', 'dandelion']);
  const each = num(p.each, 0.9);
  const grounds = list<string>(p.grounds, SKETCH_GROUNDS);
  const inkColor = str(p.ink, '#f4f1ea');
  const layers: Layer[] = motifs.map((motif, i) => {
    const t0 = i * each;
    const item: DrawItem = { id: 'motif', kind: motif as DrawItem['kind'], at: [W / 2, H / 2], size: m * 0.62, stroke: inkColor, draw: keys([t0, 0, 'sine-in-out'], [t0 + each * 0.72, 1]), ...(motif === 'rose' ? { n: 4 } : motif === 'lissajous' ? { ratio: [3, 4] } : {}) };
    const data: DrawingData = { look: 'felt', paper: grounds[i % grounds.length], step: 2, boil: 0.9, items: [item, ...(p.pen === false ? [] : [{ kind: 'pen', tool: 'nib', follow: ['motif'], rest: [W * 0.82, H * 0.22] } as DrawItem])] };
    return drawing(`page${i}`, `Sketch: ${motif}`, data, { in: t0, out: t0 + each });
  });
  return scene(ctx, motifs.length * each, layers, { background: grounds[0], cues: motifs.map((_, i) => ({ at: i * each, sound: 'key' as const })) });
}

function constellation(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  // Film 4: the nib joins stars into a figure on a crayon night sky; each star flashes as it is reached.
  const { width: W, height: H } = ctx;
  const m = Math.min(W, H);
  const rel = list<number>(p.points, [0.3, 0.3, 0.42, 0.24, 0.55, 0.28, 0.66, 0.36, 0.7, 0.52, 0.58, 0.6, 0.46, 0.55, 0.38, 0.66]);
  const pts: number[] = rel.map((v, i) => (i % 2 ? H * 0.12 + v * H * 0.7 : W * 0.5 + (v - 0.5) * m));
  const drawFor = num(p.drawFor, 2.2);
  const start = 0.3;
  const n = pts.length / 2;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]));
  const total = cum[n - 1] || 1;
  const seconds = num(p.seconds, start + drawFor + 1.4);
  const items: DrawItem[] = [
    { kind: 'stars', at: [W / 2, H / 2], size: [W, H], count: 80, fill: '#ffffff' },
    { kind: 'moon', at: [W * 0.15, H * 0.15], size: m * 0.14, stroke: null },
    { kind: 'hills', at: [W / 2, H * 0.92], size: [W, H * 0.25], colors: ['#3a4a9a', '#2f6a5a'] },
    { id: 'lines', kind: 'constellation', points: pts, ...(Array.isArray(p.edges) ? { edges: p.edges as number[] } : {}), stroke: '#ffffff', fill: 'rgba(0,0,0,0)', draw: keys([start, 0], [start + drawFor, 1]) },
    ...Array.from({ length: n }, (_, i): DrawItem => ({ kind: 'sparkle', at: [pts[i * 2], pts[i * 2 + 1]], size: m * (i === n - 1 ? 0.1 : 0.05), fill: '#ffffff', stroke: '#ffffff', pop: start + drawFor * (cum[i] / total) })),
    { kind: 'pen', tool: 'nib', follow: ['lines'], rest: [W * 0.85, H * 0.2] },
  ];
  const data: DrawingData = { look: 'crayon', paper: str(p.sky, '#2c2f7a'), step: 2, items };
  return scene(ctx, seconds, [drawing('sky', 'Constellation', data)], { background: data.paper, cues: Array.from({ length: n }, (_, i) => ({ at: start + drawFor * (cum[i] / total), sound: 'blip' as const })) });
}

// ───────────────────────── cut paper ─────────────────────────

type WordCard = { word: string; icon?: string; motif?: DrawItem['kind']; color?: string };

function paperWords(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  // Film 5: a card per beat (12 f at 120 BPM), on twos. The object and the mascot pop in two big
  // drawings with burst ticks; the word writes itself underneath in ~7 f.
  const { width: W, height: H } = ctx;
  const m = Math.min(W, H);
  const cards: WordCard[] = list<string | WordCard>(p.words, ['words', 'music', 'the sea', 'trees', 'dogs', 'rain', 'the stars', 'flowers']).map((w) => (typeof w === 'string' ? { word: w } : w));
  const beat = 60 / num(p.bpm, 120);
  const per = beat * num(p.beats, 1);
  const grounds = list<string>(p.grounds, FELT_GROUNDS.slice(0, 8));
  const mascot = p.mascot !== false;
  const layers: Layer[] = cards.map((card, i) => {
    const t0 = i * per;
    const key = card.word.toLowerCase();
    const motif = card.motif ? { kind: card.motif } : WORD_MOTIFS[key];
    const icon = card.icon ?? (motif ? undefined : WORD_ICONS[key]);
    const at: Vec = [W / 2, H * 0.47];
    const items: DrawItem[] = [];
    if (mascot) items.push({ kind: 'sprite', at: [W / 2, H * 0.33], size: m * 0.34, fill: '#df6c52', pop: t0, faces: [{ t: 0, face: i % 3 === 2 ? 'smile' : 'closed' }] });
    if (motif) items.push({ kind: motif.kind, at, size: m * 0.42, fill: card.color ?? motif.fill, ...(motif.fill2 ? { fill2: motif.fill2 } : {}), stroke: null, pop: t0, print: i % 3 === 1 ? 'news' : undefined }, ...(motif.extra ?? []).map((x) => ({ ...x, at, size: m * 0.42 })));
    else if (icon) items.push({ kind: 'icon', icon, at, size: m * 0.36, fill: card.color ?? '#3d4fb0', stroke: '#2a2733', pop: t0 });
    const letters = [...card.word].length;
    items.push({ kind: 'write', text: card.word, at: [W / 2, H * 0.83], fontSize: m * 0.1, fill: '#2a2733', from: t0 + 2 * F, cps: Math.max(8, letters / (7 * F)) });
    return drawing(`card${i}`, `Card: ${card.word}`, { look: 'cut-paper', paper: grounds[i % grounds.length], step: 2, boil: 0.8, items }, { in: t0, out: t0 + per });
  });
  return scene(ctx, cards.length * per, layers, { background: grounds[0], cues: cards.map((_, i) => ({ at: i * per, sound: 'pop' as const })) });
}

function paperNote(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  // Film 5: lined note paper pops on the desk; the question writes itself on in a blue hand.
  const { width: W, height: H } = ctx;
  const m = Math.min(W, H);
  const question = str(p.question, 'what do\nyou love?');
  const letters = [...question.replace(/\n/g, '')].length;
  const cps = num(p.cps, 10);
  const seconds = num(p.seconds, 0.4 + letters / cps + 1.4);
  const items: DrawItem[] = [
    { kind: 'blob', at: [W / 2, H / 2], size: m * 0.9, fill: str(p.spot, '#e0b36a'), stroke: null, rough: 0.12 },
    { kind: 'note', at: [W / 2, H / 2], size: [m * 0.7, m * 0.5], rotation: -3, pop: 0.15 },
    { kind: 'write', text: question, at: [W / 2, H / 2], rotation: -3, fontSize: m * 0.11, fill: str(p.ink, '#2e4a9e'), from: 0.4, cps },
  ];
  return scene(ctx, seconds, [drawing('desk', 'Note', { look: 'cut-paper', paper: str(p.desk, '#c9914e'), step: 2, items })], { background: str(p.desk, '#c9914e'), cues: [{ at: 0.15, sound: 'pop' }, { at: 0.4, sound: 'typing', duration: letters / cps }] });
}

// ───────────────────────── titles and scope ─────────────────────────

function handTitle(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  // Films 1 and 4 end cards: the name writes on at 2 f a letter above two dots, holds, fades in 4 f.
  const { width: W, height: H } = ctx;
  const m = Math.min(W, H);
  const text = str(p.text, 'opus 5');
  const sub = typeof p.subtitle === 'string' ? p.subtitle : '';
  const look = (['riso', 'crayon', 'ink', 'pencil', 'cut-paper', 'flat'] as const).find((l) => l === p.look) ?? 'riso';
  const { inks, paper } = inksOf(p.inks);
  const cps = num(p.cps, 12);
  const t1 = 0.25;
  const t2 = t1 + [...text].length / cps + 4 * F;
  const end = (sub ? t2 + [...sub].length / 16 : t2) + num(p.hold, 1.4);
  const seconds = num(p.seconds, end + 4 * F + 0.3);
  const color = str(p.color, look === 'riso' ? inks[inks.length - 1] : '#2a2f7a');
  const items: DrawItem[] = [
    { kind: 'write', text, at: [W / 2, H * 0.45], fontSize: m * 0.2, fill: color, from: t1, cps },
    ...(p.dots === false ? [] : [
      { kind: 'circle' as const, at: [W / 2 - m * 0.022, H * 0.56] as Vec, size: m * 0.03, fill: color, stroke: null, pop: 0.05 },
      { kind: 'circle' as const, at: [W / 2 + m * 0.022, H * 0.56] as Vec, size: m * 0.02, fill: look === 'riso' ? inks[1] ?? '#ff48b0' : '#e8508a', stroke: null, pop: 0.1 },
    ]),
    ...(sub ? [{ kind: 'write' as const, text: sub, at: [W / 2, H * 0.66] as Vec, fontSize: m * 0.09, fill: color, from: t2, cps: 16 }] : []),
  ];
  const data: DrawingData = { look, ...(look === 'riso' ? { inks, paper } : { paper: str(p.paper, '#efe9df') }), step: look === 'riso' ? 1 : 2, items };
  return scene(ctx, seconds, [drawing('title', 'Hand title', data, { transform: { opacity: keys([0, 100], [end, 100], [end + 4 * F, 0]) } })], { background: look === 'riso' ? paper : data.paper, cues: [{ at: t1, sound: 'typing', duration: [...text].length / cps }] });
}

function scopePanel(ctx: KitContext, p: Record<string, unknown>): MotionScene {
  // Film 3: a dark data panel beside footage — a glowing point-cloud brain that flares on each
  // spike, and two signal traces (1 f rise, ~8 f decay) scrolling underneath.
  const { width: W, height: H } = ctx;
  const side = p.side === 'left' || p.side === 'full' ? p.side : 'right';
  const pw = side === 'full' ? W : Math.round(W * num(p.width, 0.34));
  const spikes = list<number>(p.spikes, [0.6, 2.2, 3.4]);
  const seconds = num(p.seconds, Math.max(4, (spikes[spikes.length - 1] ?? 0) + 1.2));
  const items: DrawItem[] = [
    { kind: 'cloud-points', at: [pw / 2, H * 0.36], size: [pw * 0.8, H * 0.24], spikes, count: num(p.points, 900) },
    { kind: 'trace', at: [pw / 2, H * 0.82], size: [pw * 0.88, H * 0.14], spikes, window: num(p.window, 3) },
  ];
  if (typeof p.label === 'string' && p.label) items.push({ kind: 'write', text: p.label, font: 'Inter', weight: 500, at: [pw / 2, H * 0.08], fontSize: Math.min(pw, H) * 0.05, fill: '#8a93a3', from: -99 });
  const layer = drawing('scope', 'Scope panel', { look: 'scope', paper: str(p.panel, '#141416'), size: [pw, H], items }, side === 'full' ? {} : { transform: { position: [side === 'right' ? W - pw / 2 : pw / 2, H / 2] } });
  return scene(ctx, seconds, [layer], { background: null, cues: spikes.map((at) => ({ at, sound: 'blip' as const })) });
}

// ───────────────────────── specs ─────────────────────────

const INKS_PARAM = 'ink set name (classic, sunset, sea, duotone, mono, forest) or a list of 1–4 colours';

export const DRAWN_TEMPLATES: TemplateSpec[] = [
  {
    id: 'riso-world', label: 'Riso world', technique: 'drawn: riso',
    use: 'One full-frame risograph vignette (halftone inks, misregistration, paper) with the centre dot: sunrise, night, pond, bloom, sea, garden, cosmos, lighthouse, orbit. Add your own items (any drawing items) on top.',
    params: { world: `one of ${WORLDS.join(', ')} (sunrise)`, inks: INKS_PARAM, items: 'DrawItem[] — extra items drawn over the world', dot: 'boolean (true) — the centre dot', misregister: 'px (3)', seconds: 'number (3)' },
    seconds: 3, fullFrame: true, build: risoWorld,
  },
  {
    id: 'riso-ripple-open', label: 'Riso ripple open', technique: 'drawn: riso',
    use: 'Film 1\'s opening: ink rings grow out of a centre dot every 4 frames, then a riso world opens out of the dot (4 f) — as a disc that closes back (mode disc) or to the full frame (mode full). A hook or a chapter opener.',
    params: { world: `world (pond)`, inks: INKS_PARAM, openAt: 'seconds the world opens (1.5)', mode: '"disc" | "full"', hold: 'seconds the disc stays open (0.3)', seconds: 'number' },
    seconds: 3, fullFrame: true, build: risoRippleOpen,
  },
  {
    id: 'riso-montage', label: 'Riso montage', technique: 'drawn: riso',
    use: 'Film 1\'s accelerating montage: riso worlds cut under a fixed centre dot, holding 12 f, then 6, then 3; then the same worlds re-inked (palette swap) with a ring pulsing round the dot. Energy build before a reveal.',
    params: { worlds: `list of worlds (${WORLDS.filter((w) => w !== 'orbit').join(', ')})`, holds: 'frames per shot at 24 fps ([12,12,6,6,6,6,3,…])', inks: INKS_PARAM, swapInks: 'ink set for the re-inked pass (duotone)', swap: 'boolean (true)' },
    seconds: 4, fullFrame: true, build: risoMontage,
  },
  {
    id: 'pen-draws', label: 'The pen draws', technique: 'drawn: crayon/ink',
    use: 'Film 4: a big dip-pen nib draws the subject on graph paper — construction lines, the outline stroke by stroke with the pen on the tip, crayon hatching sweeping the fill in, eyes, a sparkle pop — then writes the title. Explainers, mascots, "we build it for you".',
    params: { subject: '"bot" | "sprite" | a motif (flower, tree, sun, moon, cloud, heart, planet, star) | a Lucide icon name | {d: "svg path"}', color: 'fill colour (#ec8452)', title: 'string written under it', look: '"crayon" | "ink" | "pencil"', tool: '"nib" | "pencil" | "brush" | "crayon"', drawFor: 'seconds of drawing (1.6)', faces: '[{t, face}] for bot/sprite', paper: 'colour (#f2ecdf)' },
    seconds: 4, fullFrame: true, build: penDraws,
  },
  {
    id: 'sketchbook', label: 'Generative sketchbook', technique: 'drawn: felt/ink',
    use: 'Film 4\'s montage of generative line drawings — rose curve, nautilus, snowflake, spider web, Lissajous, dandelion — each drawn by the nib on its own felt ground, then cut. "Many ideas", variety, process.',
    params: { motifs: 'list of rose, spiral, snowflake, web, lissajous, dandelion, sparkle, burst, flower, star…', each: 'seconds per page (0.9)', grounds: 'felt colours', ink: 'line colour (#f4f1ea)', pen: 'boolean (true)' },
    seconds: 5.4, fullFrame: true, build: sketchbook,
  },
  {
    id: 'constellation', label: 'Constellation', technique: 'drawn: crayon',
    use: 'Film 4: the nib joins stars into a figure on a crayon night sky; each star flashes as the line reaches it. Connecting ideas, "it all adds up", a logo hidden in the stars.',
    params: { points: 'flat list of [x, y] in 0–1 (x across the short side, y down the frame)', edges: 'pairs of point indices (default each to the next)', drawFor: 'seconds (2.2)', sky: 'colour (#2c2f7a)' },
    seconds: 3.9, fullFrame: true, build: constellation,
  },
  {
    id: 'paper-words', label: 'Cut-paper word cards', technique: 'drawn: cut-paper',
    use: 'Film 5: a beat-cut montage of cut-paper cards on felt grounds, on twos — each card pops the object (a motif or Lucide icon) and the sun-sprite mascot in with burst ticks, and the word writes itself underneath. Lists, "what we love", features, answers.',
    params: { words: 'list of words or {word, icon?, motif?, color?} (words with ready motifs: love, flowers, trees, the sea, the stars, sun, moon, rain, clouds…)', bpm: 'number (120) — one card per beat', beats: 'beats per card (1)', mascot: 'boolean (true)', grounds: 'felt colours' },
    seconds: 4, fullFrame: true, build: paperWords,
  },
  {
    id: 'paper-note', label: 'Hand-written note', technique: 'drawn: cut-paper',
    use: 'Film 5: lined note paper pops onto a desk and a question writes itself on in a blue hand. A question hook, a title card, a personal message.',
    params: { question: 'text (\\n breaks lines)', ink: 'colour (#2e4a9e)', desk: 'colour (#c9914e)', cps: 'letters a second (10)' },
    seconds: 3, fullFrame: true, build: paperNote,
  },
  {
    id: 'hand-title', label: 'Hand-written title', technique: 'drawn: any look',
    use: 'Films 1 and 4 end cards: a name writes itself on at 2 f a letter over two dots, an optional subtitle under it, holds, and fades in 4 f. End cards, sign-offs, chapter titles.',
    params: { text: 'string ("opus 5")', subtitle: 'string', look: 'riso | crayon | ink | pencil | cut-paper | flat', inks: INKS_PARAM, color: 'colour', dots: 'boolean (true)', hold: 'seconds (1.4)' },
    seconds: 2.6, fullFrame: true, build: handTitle,
  },
  {
    id: 'scope-panel', label: 'Neural scope panel', technique: 'drawn: scope',
    use: 'Film 3: a dark data panel beside footage — a glowing point-cloud "brain" that flares on each spike and two signal traces (1 f rise, ~8 f decay) scrolling beneath. Science, AI, "what it is thinking". Transparent outside the panel; place over footage.',
    params: { spikes: 'seconds of each spike ([0.6, 2.2, 3.4])', side: '"right" | "left" | "full"', width: 'panel width as a fraction of the frame (0.34)', label: 'small caption', points: 'cloud points (900)' },
    seconds: 4, fullFrame: false, build: scopePanel,
  },
];
