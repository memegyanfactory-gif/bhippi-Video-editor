// The reference opening (benchmark B1): the presenter is revealed out of an empty room by a grid
// of hot crimson cells cut from his own matte, seeded at the face and cascading down the body;
// the title sits between the room and the person; the phrase lands word by word; then the whole
// frame shrinks into a card on the crimson stage.
import { keys } from '../anim';
import type { FootageSource, Layer, MotionScene, Vec } from '../types';
import { blurFx, glowFx, headline, pal, scene, shadowFx, stage, unit, type KitContext } from './common';

export type SubjectRevealParams = {
  /** The talking-head footage with its roto matte (`matte`). */
  subject: FootageSource;
  /** The clean plate (subject erased). Without one the plain footage is the background. */
  plate?: FootageSource;
  /** Words either side of the face, sandwiched behind the subject. */
  title?: [string, string] | string[];
  /** The phrase that lands word by word under the face, with optional spoken times (scene s). */
  phrase?: string;
  phraseTimes?: number[];
  /** Face point in canvas pixels (the seed); default upper-centre of the frame. */
  face?: Vec;
  /** When the seed appears (s). */
  revealAt?: number;
  /** Seconds for the cascade to cover the body. */
  revealDuration?: number;
  /** When the frame shrinks into a card on the stage (s); null to stay full frame. */
  cardAt?: number | null;
  duration?: number;
  accent?: string;
};

export function subjectReveal(ctx: KitContext, params: SubjectRevealParams): MotionScene {
  const p = pal(ctx);
  const u = unit(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const accent = params.accent ?? p.accent;
  const at = params.revealAt ?? 0.12;
  const speed = (params.revealDuration ?? 0.55) / 0.55;
  const face = params.face ?? [W * 0.5, H * 0.3];
  const cardAt = params.cardAt === undefined ? null : params.cardAt;
  const duration = params.duration ?? Math.max(2.4, (cardAt ?? 2) + 1);
  const [left, right] = ((params.title ?? ['Motion', 'Design']) as string[]).map((word) => word?.trim()).filter(Boolean);
  const titleSize = 132 * u;
  const titleY = face[1] + 10 * u;
  const gap = 175 * u;

  // Background: the empty room, soft and grey, pulling into focus as the subject arrives.
  const plateSource = params.plate ?? { ...params.subject, matte: undefined, cutout: false };
  const plate: Layer = {
    id: 'plate',
    name: 'Clean plate',
    type: 'footage',
    source: plateSource,
    fit: 'cover',
    transform: { scale: keys<number>([0, 106, 'sine-out'], [duration, 100]) },
    effects: [
      blurFx(keys<number>([0, 22 * u, 'cubic-in-out'], [at + 0.75 * speed, 0])),
      { type: 'hue-saturation', saturation: -70, lightness: -6 },
      { type: 'vignette', amount: 0.5, size: 1.1, softness: 0.8 },
    ],
  };

  const titleLeft = left ? headline('title-left', left, ctx, { at: at + 0.1, size: titleSize, position: [face[0] - gap, titleY], align: 'right', dx: -90 * u, dy: 0, stagger: 0.05 }) : null;
  const titleRight = right ? headline('title-right', right, ctx, { at: at + 0.33, size: titleSize, position: [face[0] + gap, titleY], align: 'left', dx: 90 * u, dy: 0, stagger: 0.05 }) : null;
  // Anchor each title at its inner edge so it hugs the face: right-aligned text anchors at the
  // right of its box, left-aligned at the left (the renderer sizes text boxes; anchor 'edge' is
  // expressed through position + align with the box centred on the anchor).
  for (const layer of [titleLeft, titleRight]) {
    if (!layer || layer.type !== 'text') continue;
    layer.text.color = '#f4f4f4';
    layer.effects = [glowFx(22 * u, 0.6)];
  }

  const subject: Layer = {
    id: 'subject',
    name: 'Subject',
    type: 'footage',
    source: { ...params.subject },
    fit: 'cover',
    transform: { scale: keys<number>([0, 106, 'sine-out'], [duration, 100]) },
    effects: [{ type: 'subject-reveal', at, seed: face, speed, fill: accent, cell: 30 * u, glowRadius: 30 * u, glowIntensity: 1.2 }],
  };

  const phraseWords = (params.phrase ?? 'is not difficult').split(/\s+/).filter(Boolean);
  const phraseTimes = params.phraseTimes ?? phraseWords.map((_, i) => at + 0.62 + i * 0.16);
  const phrase: Layer = {
    id: 'phrase',
    name: 'Phrase',
    type: 'text',
    transform: { position: [face[0], face[1] + 380 * u] },
    text: {
      text: phraseWords.join(' '),
      font: ctx.font,
      size: 84 * u,
      weight: 600,
      color: '#ffffff',
      align: 'center',
      tracking: -3,
      cascade: { by: 'word', times: phraseTimes, duration: 0.45, ease: 'expo-out', from: { opacity: 0, blur: 14 * u, position: [0, 18 * u] }, dimTo: 0.55, brightenAfter: 0.22 },
    },
    effects: [glowFx(16 * u, 0.5)],
  };

  const shotLayers = [plate, ...(titleLeft ? [titleLeft] : []), ...(titleRight ? [titleRight] : []), subject, ...(phraseWords.length ? [phrase] : [])];
  const shot: MotionScene = scene(ctx, duration, shotLayers);

  if (cardAt === null) return { ...shot, cues: [{ at, sound: 'riser', note: 'seed' }, { at: at + 0.1, sound: 'impact', note: 'reveal' }], template: { id: 'subject-reveal', params: params as unknown as Record<string, unknown> } };

  // Frame-to-card: the whole shot shrinks onto the stage with a rounded rim and a shadow.
  const cardScale = 58;
  const card: Layer = {
    id: 'shot',
    name: 'Shot as card',
    type: 'precomp',
    scene: shot,
    motionBlur: true,
    transform: { scale: keys<number>([cardAt, 100, 'expo-in-out'], [cardAt + 0.55, cardScale]) },
    masks: [{ shape: 'rect', radius: keys<number>([cardAt, 0, 'expo-out'], [cardAt + 0.4, 34 * u / (cardScale / 100)]) }],
    effects: [
      { type: 'stroke', width: keys<number>([cardAt, 0], [cardAt + 0.3, 2.5 * u]), color: '#ffffff', opacity: 30, position: 'inside' },
      shadowFx(24 * u, 70 * u, 60),
    ],
  };
  return scene(ctx, duration, [stage(ctx), card], {
    cues: [{ at, sound: 'riser', note: 'seed' }, { at: at + 0.12, sound: 'impact', note: 'reveal' }, { at: cardAt - 0.05, sound: 'whoosh', note: 'frame to card' }],
    template: { id: 'subject-reveal', params: params as unknown as Record<string, unknown> },
  });
}
