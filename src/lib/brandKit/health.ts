// Brand health: a 0–100 score for a kit, with a plain message per check and, where a click can mend
// it, a fix that returns the repaired kit. Pure: what only the webview knows (which fonts are
// installed) comes in through `env`.

import { contrastRatio, isDark, isHex, mix } from './build';
import { easingToBezier, fixContrast } from './studio';
import type { BrandColorToken, BrandKit, BrandLogo, ColorRole } from './types';

export type HealthStatus = 'pass' | 'warn' | 'fail';

export type HealthCheck = {
  id: string;
  label: string;
  status: HealthStatus;
  /** Share of the score. */
  weight: number;
  /** What is wrong (or right), in a sentence. */
  message: string;
  /** The Brand Studio section that owns it (a nav id). */
  section: 'overview' | 'logo' | 'colour' | 'type' | 'motion' | 'voice' | 'imagery' | 'layout';
  fixLabel?: string;
  /** One click: the kit with this check mended. */
  fix?: (kit: BrandKit) => BrandKit;
};

export type HealthEnv = {
  /** Whether the webview can render `family` (document.fonts.check). Unknown = assume yes. */
  fontAvailable?: (family: string) => boolean;
};

export type BrandHealth = { score: number; grade: 'excellent' | 'good' | 'fair' | 'needs work'; checks: HealthCheck[] };

const token = (kit: BrandKit, role: ColorRole): BrandColorToken | undefined => kit.colors.tokens.find((t) => t.role === role);
const hexOf = (kit: BrandKit, role: ColorRole): string | undefined => { const h = token(kit, role)?.hex; return isHex(h) ? h : undefined; };
const touch = (kit: BrandKit): BrandKit => ({ ...kit, updatedAt: new Date().toISOString() });
const setToken = (kit: BrandKit, role: ColorRole, hex: string): BrandKit => {
  const palette = { ...kit.palette };
  if (role === 'accent') palette.accent = hex;
  if (role === 'background') palette.ink = hex;
  if (role === 'surface') palette.surface = hex;
  if (role === 'text') palette.text = hex;
  if (role === 'muted') palette.muted = hex;
  if (role === 'secondary') palette.accentAlt = hex;
  return touch({ ...kit, palette, colors: { ...kit.colors, tokens: kit.colors.tokens.map((t) => (t.role === role ? { ...t, hex } : t)) } });
};
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** The colours a complete palette carries, with the value a fix adds when one is missing. */
const REQUIRED: { role: ColorRole; name: string; make: (kit: BrandKit) => string }[] = [
  { role: 'background', name: 'Background', make: () => '#0f1115' },
  { role: 'text', name: 'Text', make: (kit) => (isDark(hexOf(kit, 'background') ?? '#0f1115') ? '#f5f5f7' : '#111111') },
  { role: 'surface', name: 'Surface', make: (kit) => { const bg = hexOf(kit, 'background') ?? '#0f1115'; return mix(bg, isDark(bg) ? '#ffffff' : '#000000', 0.08); } },
  { role: 'muted', name: 'Muted', make: (kit) => mix(hexOf(kit, 'text') ?? '#f5f5f7', hexOf(kit, 'background') ?? '#0f1115', 0.45) },
  { role: 'primary', name: 'Primary', make: (kit) => hexOf(kit, 'accent') ?? '#2d8ceb' },
  { role: 'accent', name: 'Accent', make: (kit) => mix(hexOf(kit, 'primary') ?? '#2d8ceb', '#ffffff', 0.2) },
  { role: 'success', name: 'Success', make: () => '#1fbf75' },
  { role: 'warning', name: 'Warning', make: () => '#f5b301' },
  { role: 'error', name: 'Error', make: () => '#ff3b30' },
];

function contrastCheck(kit: BrandKit): HealthCheck {
  const bg = hexOf(kit, 'background');
  const surface = hexOf(kit, 'surface');
  const text = hexOf(kit, 'text');
  const base: Pick<HealthCheck, 'id' | 'label' | 'weight' | 'section'> = { id: 'contrast', label: 'Text is readable', weight: 14, section: 'colour' };
  if (!bg || !text) return { ...base, status: 'fail', message: 'There is no text or background colour to measure.' };
  const onBg = contrastRatio(text, bg);
  const onSurface = surface ? contrastRatio(text, surface) : onBg;
  const worst = Math.min(onBg, onSurface);
  if (worst >= 4.5) return { ...base, status: 'pass', message: `Text reads at ${worst}:1 or better on the background and the surface (AA needs 4.5).` };
  const fixed = fixContrast(fixContrast(text, bg), surface ?? bg);
  return {
    ...base,
    status: worst >= 3 ? 'warn' : 'fail',
    message: `Text on ${onSurface < onBg ? 'the surface' : 'the background'} is only ${worst}:1; captions and titles need 4.5:1.`,
    fixLabel: 'Adjust the text colour',
    fix: (k) => setToken(k, 'text', fixed),
  };
}

function accentCheck(kit: BrandKit): HealthCheck {
  const bg = hexOf(kit, 'background');
  const accent = hexOf(kit, 'accent');
  const base: Pick<HealthCheck, 'id' | 'label' | 'weight' | 'section'> = { id: 'accent', label: 'Accent stands out', weight: 6, section: 'colour' };
  if (!bg || !accent) return { ...base, status: 'warn', message: 'Add an accent colour so one word per frame can pop.' };
  const ratio = contrastRatio(accent, bg);
  if (ratio >= 3) return { ...base, status: 'pass', message: `The accent holds ${ratio}:1 against the background.` };
  return { ...base, status: 'warn', message: `The accent is only ${ratio}:1 against the background; highlights will sink into it.`, fixLabel: 'Brighten the accent', fix: (k) => setToken(k, 'accent', fixContrast(accent, bg, 3.2)) };
}

function addInverseLogo(kit: BrandKit): BrandKit {
  const source: BrandLogo | undefined = kit.logos.find((l) => l.role === 'primary') ?? kit.logos[0];
  if (!source) return kit;
  const inverse: BrandLogo = { ...source, id: `logo_${Math.random().toString(36).slice(2, 9)}`, role: 'inverse', on: source.on === 'dark' ? 'light' : 'dark' };
  return touch({ ...kit, logos: [...kit.logos, inverse] });
}

export function brandHealth(kit: BrandKit, env: HealthEnv = {}): BrandHealth {
  const checks: HealthCheck[] = [];
  checks.push(contrastCheck(kit), accentCheck(kit));

  // Logo ---------------------------------------------------------------
  const hasLogo = kit.logos.length > 0;
  checks.push(hasLogo
    ? { id: 'logo', label: 'Logo added', weight: 10, section: 'logo', status: 'pass', message: `${kit.logos.length} logo variant${kit.logos.length === 1 ? '' : 's'} on file.` }
    : { id: 'logo', label: 'Logo added', weight: 10, section: 'logo', status: 'fail', message: 'No logo yet; graphics fall back to a monogram. Upload an SVG or PNG on the Logo board.' });
  const vector = kit.logos.some((l) => !!l.svg);
  checks.push(!hasLogo
    ? { id: 'vector', label: 'Vector logo', weight: 6, section: 'logo', status: 'fail', message: 'Without a logo there is nothing to scale cleanly.' }
    : vector
      ? { id: 'vector', label: 'Vector logo', weight: 6, section: 'logo', status: 'pass', message: 'An SVG logo is on file, so it stays sharp at any size.' }
      : { id: 'vector', label: 'Vector logo', weight: 6, section: 'logo', status: 'warn', message: 'Only a raster logo is on file; it blurs when scaled up. Add an SVG if you have one.' });
  const variants = kit.logos.some((l) => l.role === 'inverse' || l.role === 'monochrome') || kit.logos.some((l) => l.on === 'any') || new Set(kit.logos.map((l) => l.on)).size > 1;
  checks.push(!hasLogo
    ? { id: 'variants', label: 'Light and dark logos', weight: 6, section: 'logo', status: 'fail', message: 'Add a logo first, then a version for the opposite background.' }
    : variants
      ? { id: 'variants', label: 'Light and dark logos', weight: 6, section: 'logo', status: 'pass', message: 'The logo has a version for light and dark backgrounds.' }
      : { id: 'variants', label: 'Light and dark logos', weight: 6, section: 'logo', status: 'warn', message: 'Only one logo variant; it may vanish on the opposite background.', fixLabel: 'Add an inverse variant', fix: addInverseLogo });

  // Fonts ---------------------------------------------------------------
  const faces = (['display', 'heading', 'body', 'caption'] as const).map((k) => kit.typography[k]);
  const families = [...new Set(faces.map((f) => f.family))];
  const missing = env.fontAvailable ? families.filter((f) => !env.fontAvailable!(f)) : [];
  checks.push(missing.length
    ? {
        id: 'fonts', label: 'Fonts are available', weight: 8, section: 'type', status: 'warn',
        message: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not installed here, so previews and exports use the fallback.`,
        fixLabel: 'Switch to Segoe UI',
        fix: (k) => touch({ ...k, typography: { ...k.typography, ...Object.fromEntries((['display', 'heading', 'body', 'caption'] as const).filter((face) => missing.includes(k.typography[face].family)).map((face) => [face, { ...k.typography[face], family: 'Segoe UI', fallback: '"Segoe UI", Arial, Helvetica, sans-serif' }])) } }),
      }
    : { id: 'fonts', label: 'Fonts are available', weight: 8, section: 'type', status: 'pass', message: env.fontAvailable ? 'Every brand font renders on this machine.' : 'Font availability is checked in the app.' });

  // Palette -------------------------------------------------------------
  const absent = REQUIRED.filter((r) => !hexOf(kit, r.role));
  checks.push(absent.length
    ? {
        id: 'palette', label: 'Palette is complete', weight: 10, section: 'colour', status: absent.length > 3 ? 'fail' : 'warn',
        message: `Missing ${absent.map((a) => a.name.toLowerCase()).join(', ')}.`,
        fixLabel: `Add ${absent.length} colour${absent.length === 1 ? '' : 's'}`,
        fix: (k) => {
          let next = k;
          for (const r of REQUIRED) {
            if (hexOf(next, r.role)) continue;
            const hex = r.make(next);
            const existing = next.colors.tokens.find((t) => t.role === r.role);
            next = existing
              ? setToken(next, r.role, hex)
              : touch({ ...next, colors: { ...next.colors, tokens: [...next.colors.tokens, { name: r.name, hex, role: r.role, usage: '' }] } });
          }
          return next;
        },
      }
    : { id: 'palette', label: 'Palette is complete', weight: 10, section: 'colour', status: 'pass', message: 'Background, surface, text, muted, primary, accent and the status colours are all set.' });

  // Type hierarchy ------------------------------------------------------
  const s = kit.typography.scale;
  const ordered = s.hook > s.title && s.title > s.subtitle && s.subtitle > s.body && s.body >= s.label;
  const tooMany = families.length > 3;
  checks.push(!ordered || tooMany
    ? {
        id: 'type', label: 'Type hierarchy', weight: 8, section: 'type', status: 'warn',
        message: !ordered ? 'The type sizes do not step down from hook to body, so hierarchy blurs.' : `${families.length} different fonts across the four roles; two usually look more designed.`,
        ...(!ordered ? {
          fixLabel: 'Restore a clear scale',
          fix: (k: BrandKit) => {
            const sorted = [k.typography.scale.hook, k.typography.scale.title, k.typography.scale.subtitle, k.typography.scale.body, k.typography.scale.label].sort((a, b) => b - a);
            const [hook, title, subtitle, body, label] = [sorted[0], Math.min(sorted[1], sorted[0] * 0.8), Math.min(sorted[2], sorted[1] * 0.75), Math.min(sorted[3], sorted[2] * 0.8), Math.min(sorted[4], sorted[3])];
            const scale = { ...k.typography.scale, hook, title, subtitle, body, label };
            return touch({ ...k, type: scale, typography: { ...k.typography, scale } });
          },
        } : {}),
      }
    : { id: 'type', label: 'Type hierarchy', weight: 8, section: 'type', status: 'pass', message: `Sizes step down cleanly across ${families.length} font${families.length === 1 ? '' : 's'}.` });

  // Motion --------------------------------------------------------------
  const m = kit.motionGuide;
  const motionIssues: string[] = [];
  if (!(m.enter >= 0.15 && m.enter <= 1.5)) motionIssues.push('enter should be 0.15–1.5 s');
  if (!(m.exit > 0 && m.exit <= m.enter * 1.5 + 0.01)) motionIssues.push('exit should be quicker than enter');
  if (!(m.hold >= 0.5 && m.hold <= 6)) motionIssues.push('hold should be 0.5–6 s');
  if (!(m.stagger >= 0 && m.stagger <= 0.3)) motionIssues.push('stagger should be under 0.3 s');
  if (!easingToBezier(m.easing)) motionIssues.push('the easing is not a curve');
  checks.push(motionIssues.length
    ? {
        id: 'motion', label: 'Motion timings', weight: 7, section: 'motion', status: 'warn', message: `${motionIssues.join('; ')}.`,
        fixLabel: 'Use sane timings',
        fix: (k) => touch({ ...k, motionGuide: { ...k.motionGuide, enter: clamp(k.motionGuide.enter || 0.5, 0.15, 1.5), exit: clamp(Math.min(k.motionGuide.exit || 0.35, (clamp(k.motionGuide.enter || 0.5, 0.15, 1.5)) * 1.5), 0.1, 1.5), hold: clamp(k.motionGuide.hold || 2, 0.5, 6), stagger: clamp(k.motionGuide.stagger || 0.06, 0, 0.3), easing: easingToBezier(k.motionGuide.easing) ? k.motionGuide.easing : 'cubic-bezier(0.16, 1, 0.3, 1)' } }),
      }
    : { id: 'motion', label: 'Motion timings', weight: 7, section: 'motion', status: 'pass', message: `Enter ${m.enter}s, exit ${m.exit}s, hold ${m.hold}s: comfortable to watch.` });

  // Voice ---------------------------------------------------------------
  const v = kit.voiceGuide;
  const voiceGaps = [v.tone.length < 2 && 'two tone words', v.use.length < 2 && 'phrases to use', v.avoid.length < 1 && 'words to avoid', v.samples.length < 2 && 'two sample lines'].filter((x): x is string => !!x);
  checks.push(voiceGaps.length
    ? { id: 'voice', label: 'Voice is written down', weight: 7, section: 'voice', status: voiceGaps.length > 2 ? 'fail' : 'warn', message: `Add ${voiceGaps.join(', ')} so captions and scripts sound like the brand.` }
    : { id: 'voice', label: 'Voice is written down', weight: 7, section: 'voice', status: 'pass', message: 'Tone, do and avoid lists and sample lines are all filled in.' });

  // Imagery -------------------------------------------------------------
  const g = kit.imagery.grade;
  const extreme = (['saturation', 'contrast', 'warmth'] as const).filter((key) => Math.abs(g[key]) > 0.6);
  const noPrefix = !kit.imagery.promptPrefix.trim();
  checks.push(extreme.length || noPrefix
    ? {
        id: 'imagery', label: 'Imagery grade', weight: 5, section: 'imagery', status: 'warn',
        message: extreme.length ? `The ${extreme.join(' and ')} grade is extreme; footage will look processed.` : 'No prompt prefix, so generated images will not share a look.',
        ...(extreme.length ? { fixLabel: 'Ease the grade', fix: (k: BrandKit) => touch({ ...k, imagery: { ...k.imagery, grade: { ...k.imagery.grade, saturation: clamp(k.imagery.grade.saturation, -0.6, 0.6), contrast: clamp(k.imagery.grade.contrast, -0.6, 0.6), warmth: clamp(k.imagery.grade.warmth, -0.6, 0.6) } } }) } : {}),
      }
    : { id: 'imagery', label: 'Imagery grade', weight: 5, section: 'imagery', status: 'pass', message: 'A restrained grade and a prompt prefix keep every image on brand.' });

  // Safe margin ---------------------------------------------------------
  const margin = kit.layout.safeMargin;
  checks.push(margin < 0.03 || margin > 0.1
    ? { id: 'margin', label: 'Safe margin', weight: 4, section: 'layout', status: 'warn', message: margin < 0.03 ? 'Under 3% of the frame: titles can be cropped on phones and TVs.' : 'Over 10% of the frame: graphics will feel small.', fixLabel: 'Set it to 5%', fix: (k) => touch({ ...k, layout: { ...k.layout, safeMargin: 0.05 } }) }
    : { id: 'margin', label: 'Safe margin', weight: 4, section: 'layout', status: 'pass', message: `${Math.round(margin * 100)}% of the frame stays clear on every side.` });

  // Identity ------------------------------------------------------------
  const idGaps = [!kit.tagline.trim() && 'a tagline', !kit.audience.trim() && 'an audience', kit.values.length < 2 && 'two values'].filter((x): x is string => !!x);
  checks.push(idGaps.length
    ? { id: 'identity', label: 'Identity is described', weight: 5, section: 'overview', status: 'warn', message: `Add ${idGaps.join(', ')}; the AI writes better copy when it knows who this is for.` }
    : { id: 'identity', label: 'Identity is described', weight: 5, section: 'overview', status: 'pass', message: 'Tagline, audience and values are set.' });

  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce((sum, c) => sum + c.weight * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0);
  const score = Math.round((earned / total) * 100);
  return { score, grade: score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 50 ? 'fair' : 'needs work', checks };
}

/** Applies every available fix once, in order. */
export const fixAll = (kit: BrandKit, health: BrandHealth): BrandKit => health.checks.reduce((k, c) => (c.fix && c.status !== 'pass' ? c.fix(k) : k), kit);
