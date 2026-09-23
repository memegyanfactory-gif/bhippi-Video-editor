// A brand kit as the motion engine needs it: resolved colours, fonts, eases and timings, plus the
// guideline the `brand-*` templates render. Kept on each branded scene (`scene.brand`) so a scene
// rebuilds and exports the same even if the kit changes later.
import type { Ease } from '../../motion/types';
import { brandColors, guidelineOf } from './guideline';
import type { BrandGuideline, BrandKit } from './types';

export type MotionBrand = {
  kitId: string;
  name: string;
  tagline: string;
  colors: ReturnType<typeof brandColors>;
  stageDark: boolean;
  gradient: string[];
  fonts: { display: string; heading: string; body: string; caption: string };
  weights: { display: number; heading: number; body: number; caption: number };
  transform: { display: string; heading: string };
  ease: Ease;
  easeIn: Ease;
  enter: number;
  exit: number;
  hold: number;
  stagger: number;
  wordStagger: number;
  distance: number;
  blur: number;
  overshoot: number;
  /** Corner radius as a fraction of the short side. */
  radius: number;
  safeMargin: number;
  /** A library asset of the primary logo, when the kit has an imported raster/SVG file. */
  logoAsset: string | null;
  guideline: BrandGuideline;
};

/** `cubic-bezier(a, b, c, d)` or an engine ease name → an engine Ease. */
export function toEase(value: string | undefined, fallback: Ease): Ease {
  if (!value) return fallback;
  const m = value.match(/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
  if (m) {
    const curve = [m[1], m[2], m[3], m[4]].map(Number);
    if (curve.every(Number.isFinite)) return curve as [number, number, number, number];
  }
  const names = ['linear', 'hold', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'sine-in', 'sine-out', 'sine-in-out', 'cubic-in', 'cubic-out', 'cubic-in-out', 'quart-in', 'quart-out', 'quart-in-out', 'expo-in', 'expo-out', 'expo-in-out'];
  return names.includes(value) ? (value as Ease) : fallback;
}

const isHexColor = (v: string) => /^#[0-9a-f]{6}$/i.test(v);
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

export function motionBrandFromKit(kit: BrandKit): MotionBrand {
  const g = guidelineOf(kit);
  const colors = brandColors(kit);
  const logo = kit.logos.find((l) => l.role === 'primary' && l.assetId) ?? kit.logos.find((l) => l.assetId);
  return {
    kitId: kit.id,
    name: kit.name,
    tagline: kit.tagline,
    colors,
    stageDark: g.color.stage.tone === 'dark' || (isHexColor(colors.background) && lum(colors.background) < 0.35),
    gradient: g.color.stage.gradient.filter(isHexColor).length >= 2 ? g.color.stage.gradient.filter(isHexColor) : [colors.background, colors.surface],
    fonts: { display: kit.typography.display.family, heading: kit.typography.heading.family, body: kit.typography.body.family, caption: kit.typography.caption.family },
    weights: { display: kit.typography.display.weight, heading: kit.typography.heading.weight, body: kit.typography.body.weight, caption: kit.typography.caption.weight },
    transform: { display: kit.typography.display.transform, heading: kit.typography.heading.transform },
    ease: toEase(g.motion.easing.enter, 'expo-out'),
    easeIn: toEase(g.motion.easing.exit, 'expo-in'),
    enter: g.motion.timing.enter,
    exit: g.motion.timing.exit,
    hold: g.motion.timing.hold,
    stagger: g.motion.timing.stagger,
    wordStagger: g.motion.timing.wordStagger,
    distance: g.motion.distance,
    blur: g.motion.blur,
    overshoot: g.motion.overshoot,
    radius: kit.layout.radius,
    safeMargin: kit.layout.safeMargin,
    logoAsset: logo?.assetId ?? null,
    guideline: g,
  };
}
