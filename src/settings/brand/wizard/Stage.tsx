// The little animated stage every direction, style card and refine preview plays on: the palette
// sweeps in, then the brand name reveals with the direction's own motion (a calm blurred fade, a
// masked rise, or a springy pop), then a button pill and tagline settle. Replays when `tick` changes.

import { useEffect, useState, type CSSProperties } from 'react';
import { contrastRatio, type MotionIntensity } from '../../../lib/brandKit';
import type { WordmarkStyle } from '../../../lib/brandKit/directions';

export type StageColors = { bg: string; surface: string; text: string; muted: string; primary: string; accent: string; accent2: string };

export type StageSpec = {
  name: string;
  colors: StageColors;
  display: { family: string; weight: number; transform: string; letterSpacing: string };
  body: string;
  motion: { easing: string; enter: number; stagger: number; intensity: MotionIntensity };
  /** The user's own logo; when absent the name is the wordmark. */
  logo?: { svg?: string | null; dataUrl?: string | null } | null;
  wordmark?: WordmarkStyle;
  tagline?: string;
};

export const prefersReducedMotion = (): boolean => {
  try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** A counter that bumps every `periodMs` while `enabled`, so a preview can replay itself. */
export function useReplay(periodMs: number, enabled = true): [number, () => void] {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || prefersReducedMotion()) return undefined;
    const id = window.setInterval(() => setTick((n) => n + 1), periodMs);
    return () => window.clearInterval(id);
  }, [periodMs, enabled]);
  return [tick, () => setTick((n) => n + 1)];
}

const KIND: Record<MotionIntensity, 'calm' | 'balanced' | 'energetic'> = { calm: 'calm', balanced: 'balanced', energetic: 'energetic' };

export function Stage({ spec, tick = 0, lead = 0, size = 'lg', className = '' }: { spec: StageSpec; tick?: number; /** Seconds before the first play (cinematic stagger). */ lead?: number; size?: 'lg' | 'md' | 'sm'; className?: string }) {
  const { colors: c, motion } = spec;
  const text = (spec.name.trim() || 'Your brand');
  const upper = spec.display.transform === 'uppercase';
  const letters = Array.from(text);
  const fs = Math.max(4.4, Math.min(13, 74 / (letters.length * (upper ? 0.78 : 0.62))));
  const kind = KIND[motion.intensity];
  const enter = Math.max(0.3, motion.enter);
  const delay = (tick === 0 ? lead : 0) + 0.22;
  const style = {
    '--pt': contrastRatio('#ffffff', c.primary) >= contrastRatio('#111111', c.primary) ? '#ffffff' : '#111111', '--bg': c.bg, '--surface': c.surface, '--tx': c.text, '--mu': c.muted, '--p': c.primary, '--a': c.accent, '--a2': c.accent2,
    '--ease': motion.easing, '--enter': `${enter}s`, '--stagger': `${Math.max(0.025, motion.stagger * 0.55)}s`, '--lead': `${delay}s`, '--fs': fs,
    '--ff': `'${spec.display.family}', 'Segoe UI', sans-serif`, '--fw': spec.display.weight, '--ls': spec.display.letterSpacing, '--tt': spec.display.transform, '--bf': `'${spec.body}', 'Segoe UI', sans-serif`,
  } as CSSProperties;
  const hasLogo = !!(spec.logo && (spec.logo.svg || spec.logo.dataUrl));
  const sweep = [c.primary, c.accent, c.accent2, c.surface, c.text];
  const wm = spec.wordmark ?? 'dot';
  return (
    <div className={`bw-stage bw-stage-${size} ${className}`} style={style} data-kind={kind} aria-hidden="true">
      <div className="bw-stage-sweep" key={`s${tick}`}>
        {sweep.map((color, i) => <i key={i} style={{ background: color, '--k': i } as CSSProperties} />)}
      </div>
      <div className="bw-stage-body" key={`b${tick}`}>
        {hasLogo && (
          <div className="bw-stage-logo">
            {spec.logo?.svg ? <span dangerouslySetInnerHTML={{ __html: spec.logo.svg }} /> : <img src={spec.logo?.dataUrl ?? ''} alt="" />}
          </div>
        )}
        <h4 className={`bw-stage-name bw-rv-${kind}`}>
          {letters.map((ch, i) => (
            <span key={i} className={`bw-ch${wm === 'initial' && i === 0 && !hasLogo ? ' is-accent' : ''}`} style={{ '--i': i } as CSSProperties}>{ch === ' ' ? ' ' : ch}</span>
          ))}
          {wm === 'dot' && !hasLogo && <span className="bw-ch is-accent" style={{ '--i': letters.length } as CSSProperties}>.</span>}
        </h4>
        {wm === 'bar' && !hasLogo && <i className="bw-stage-bar" />}
        {spec.tagline && size !== 'sm' && <p className="bw-stage-tag">{spec.tagline}</p>}
        {size !== 'sm' && <span className="bw-stage-pill">Get started</span>}
      </div>
    </div>
  );
}
