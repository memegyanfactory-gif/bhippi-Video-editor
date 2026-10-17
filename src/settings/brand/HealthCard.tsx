// Brand health: a score ring, every check with its plain message and a one-click fix.

import { AlertTriangle, Check, CircleAlert, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BrandKit } from '../../lib/brandKit';
import { brandHealth, fixAll, type BrandHealth, type HealthCheck } from '../../lib/brandKit/health';
import { fontInstalled } from './fonts';
import { prefersReducedMotion } from './shared';

/** The health of a kit, with fonts measured in this webview. */
export const useBrandHealth = (kit: BrandKit): BrandHealth => useMemo(() => brandHealth(kit, { fontAvailable: fontInstalled }), [kit]);

/** Counts up to `target` (an eased rAF tween), or jumps there under reduced motion. */
export function useCountUp(target: number, ms = 900): number {
  const [value, setValue] = useState(prefersReducedMotion() ? target : 0);
  const from = useRef(value);
  useEffect(() => {
    if (prefersReducedMotion()) { setValue(target); return; }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = origin + (target - origin) * eased;
      from.current = v;
      setValue(v);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return Math.round(value);
}

export function ScoreRing({ score, size = 112, grade }: { score: number; size?: number; grade?: string }) {
  const shown = useCountUp(score);
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const tone = score >= 90 ? 'great' : score >= 75 ? 'good' : score >= 50 ? 'fair' : 'poor';
  return (
    <div className={`bs-ring ${tone}`} style={{ width: size, height: size }} role="img" aria-label={`Brand health ${score} out of 100${grade ? `, ${grade}` : ''}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="bs-ring-track" />
        <circle cx={size / 2} cy={size / 2} r={r} className="bs-ring-arc" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="bs-ring-num"><b>{shown}</b><small>{grade ?? 'health'}</small></span>
    </div>
  );
}

const ICON = { pass: Check, warn: AlertTriangle, fail: CircleAlert } as const;

export function HealthCard({ kit, health, onReplace, onJump, compact }: { kit: BrandKit; health: BrandHealth; onReplace: (kit: BrandKit) => void; onJump?: (section: HealthCheck['section']) => void; compact?: boolean }) {
  const open = health.checks.filter((c) => c.status !== 'pass');
  const fixable = open.filter((c) => c.fix);
  const ordered = [...health.checks].sort((a, b) => (a.status === 'pass' ? 1 : 0) - (b.status === 'pass' ? 1 : 0));
  const [justFixed, setJustFixed] = useState<string | null>(null);
  const apply = (check: HealthCheck) => { onReplace(check.fix!(kit)); setJustFixed(check.id); window.setTimeout(() => setJustFixed((id) => (id === check.id ? null : id)), 1400); };
  return (
    <div className={`bs-health${compact ? ' compact' : ''}`}>
      <div className="bs-health-top">
        <ScoreRing score={health.score} grade={health.grade} />
        <div className="bs-health-sum">
          <strong>{open.length === 0 ? 'Everything checks out' : `${open.length} thing${open.length === 1 ? '' : 's'} to look at`}</strong>
          <span>{health.checks.length - open.length} of {health.checks.length} checks pass. The score weighs readability and the logo most.</span>
          {fixable.length > 1 && <button type="button" className="bs-btn primary" onClick={() => onReplace(fixAll(kit, health))}><Wand2 size={13} /> Fix {fixable.length} automatically</button>}
        </div>
      </div>
      <ul className="bs-checks">
        {ordered.map((check) => {
          const Icon = ICON[check.status];
          return (
            <li key={check.id} className={`bs-check ${check.status}${justFixed === check.id ? ' mended' : ''}`}>
              <span className="bs-check-ico"><Icon size={12} strokeWidth={3} /></span>
              <div className="bs-check-text">
                <b>{check.label}</b>
                <span>{check.message}</span>
              </div>
              {check.fix && check.status !== 'pass' && <button type="button" className="bs-btn small" onClick={() => apply(check)}>{check.fixLabel ?? 'Fix'}</button>}
              {!check.fix && check.status !== 'pass' && onJump && <button type="button" className="bs-btn small ghost" onClick={() => onJump(check.section)}>Open</button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
