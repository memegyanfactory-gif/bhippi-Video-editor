// Lab scenes for the Overlay template group (dev-only harness).
import { cardWall3D, cutoutStage, cutoutSubjectBox, dockCursor, frameToCard, splitRulesPanel, statBadges } from '../kit/overlayTemplates';
import type { FootageSource, Layer, MotionScene } from '../types';

const land = { width: 1280, height: 720 };
const tall = { width: 1080, height: 1920 };
// talk.mp4 is 2.4 s: ping-pong it so longer scenes keep moving.
const loop = { expr: 'var p = time % 4.6; p < 2.3 ? p : 4.6 - p', v: 0 };
const talk: FootageSource = { path: 'talk.mp4', in: 0, timeRemap: loop };
const cut: FootageSource = { path: 'talk.mp4', in: 0, matte: 'matte@29.97@72', cutout: true };
const still = (i: number): FootageSource => ({ path: `stills/still${i}.jpg`, kind: 'image' });
const stills = Array.from({ length: 12 }, (_, i) => still(i + 1));

/** Puts the talking head under an overlay scene so it can be judged over video. */
function overFootage(scene: MotionScene): MotionScene {
  const under: Layer = { id: 'lab-footage', type: 'footage', source: talk, fit: 'cover' };
  return { ...scene, background: '#000000', layers: [under, ...scene.layers] };
}

const badges = [
  { value: 150, suffix: 'K+', label: 'subscribers', icon: '▶', position: 'top-left' as const, at: 0.15 },
  { value: 998, from: 907, prefix: '$', suffix: 'M+', label: 'total views', icon: '👁', position: 'top-right' as const, at: 0.45, swap: '$1B+' },
];

const dockIcons = [
  { label: 'Figma', color: '#a259ff', glyph: 'F' },
  { label: 'After Effects', color: '#2b1a6e', glyph: 'Ae' },
  { label: 'Blender', color: '#f5792a', glyph: 'B' },
  { label: 'Premiere', color: '#1c1f5e', glyph: 'Pr' },
  { label: 'Notion', color: '#e9e9e9', glyph: 'N' },
];

function cutoutLab(ctx: { width: number; height: number }, subjectScale = 100) {
  const [sx, sy, sw, sh] = cutoutSubjectBox(ctx, { subjectScale });
  // talk.mp4's subject sits at ~51% x, face ~25% y of the source frame.
  const bx = (fx: number) => sx + (fx - 0.5) * sw;
  const byy = (fy: number) => sy - sh / 2 + fy * sh;
  return cutoutStage(ctx, {
    subject: cut,
    subjectScale,
    name: 'Prem Sagar',
    role: 'our private coaching member',
    callouts: [
      { anchor: [bx(0.6), byy(0.5)], text: '15K per month', detail: 'video editor\n8-9 hours per day', at: 1.9, side: 'right' },
      { anchor: [bx(0.44), byy(0.72)], text: '35K in a week', at: 2.7, side: 'left' },
    ],
    duration: 4.2,
  });
}

export const OVERLAY_LAB_SCENES: Record<string, () => MotionScene> = {
  'overlay-card': () => frameToCard(land, { footage: talk, at: 0.3, exit: 'left', exitAt: 2.0, next: still(3) }),
  'overlay-card-push': () => frameToCard(land, { footage: still(5), at: 0.2, exit: 'push', exitAt: 1.6 }),
  'overlay-wall': () => cardWall3D(land, { images: stills }),
  'overlay-wall-tall': () => cardWall3D(tall, { images: stills }),
  'overlay-cutout': () => cutoutLab(land, 88),
  'overlay-cutout-tall': () => cutoutLab(tall),
  'overlay-rules': () => splitRulesPanel(land, {
    footage: talk,
    title: '3 RULES',
    subtitle: 'For building your portfolio',
    rules: [{ text: '4 great pieces > 30 average ones', at: 1.2 }, { text: 'Show the process', at: 2.0 }, { text: 'Treat portfolio like design itself', at: 2.8 }],
    duration: 4,
  }),
  'overlay-rules-tall': () => splitRulesPanel(tall, {
    footage: talk,
    title: '3 RULES',
    subtitle: 'For building your portfolio',
    rules: [{ text: '4 great pieces > 30 average ones', at: 1.2 }, { text: 'Show the process', at: 2.0 }, { text: 'Treat portfolio like design itself', at: 2.8 }],
    duration: 4,
  }),
  'overlay-badges': () => overFootage(statBadges(land, { badges })),
  'overlay-badges-tall': () => overFootage(statBadges(tall, { badges })),
  'overlay-dock': () => overFootage(dockCursor(land, { icons: dockIcons, clicks: [{ index: 0, at: 1.0 }, { index: 2, at: 1.8 }, { index: 4, at: 2.6 }] })),
  'overlay-dock-tall': () => overFootage(dockCursor(tall, { icons: dockIcons, clicks: [{ index: 1, at: 1.0 }, { index: 3, at: 1.9 }] })),
};
