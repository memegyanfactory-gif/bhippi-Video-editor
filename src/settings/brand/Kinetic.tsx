// Kinetic text and transition demos driven by the kit's own motion settings (easing, enter, exit,
// hold, stagger, intensity). Built on the Web Animations API so a setting change only restarts the
// animation, never re-renders the page. Static under prefers-reduced-motion.

import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { easingToBezier } from '../../lib/brandKit/studio';
import type { BrandKit } from '../../lib/brandKit';
import { faceStyle, prefersReducedMotion } from './shared';

export const travelFor = (intensity: BrandKit['motionGuide']['intensity']): number => (intensity === 'energetic' ? 46 : intensity === 'calm' ? 14 : 26);

/** The kit's easing as a CSS timing function (named eases become their curve). */
export const cssEase = (easing: string): string => { const b = easingToBezier(easing); return b ? `cubic-bezier(${b.join(',')})` : 'cubic-bezier(0.16,1,0.3,1)'; };

export function KineticText({ kit, text, size = 40, replayKey = 0, className }: { kit: BrandKit; text: string; size?: number; replayKey?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const m = kit.motionGuide;
  const words = text.trim().split(/\s+/).filter(Boolean);
  useEffect(() => {
    const root = ref.current;
    if (!root || prefersReducedMotion()) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('span.w'));
    const dist = travelFor(m.intensity);
    const enter = Math.max(0.1, m.enter), exit = Math.max(0.1, m.exit), hold = Math.max(0.3, Math.min(m.hold, 3));
    const stagger = Math.max(0, Math.min(m.stagger, 0.4));
    const rest = 0.45;
    const total = enter + stagger * Math.max(0, els.length - 1) + hold + exit + rest;
    const easing = cssEase(m.easing);
    const hidden = (y: number) => ({ opacity: 0, transform: `translateY(${y}px)`, filter: 'blur(8px)' });
    const shown = { opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' };
    const anims = els.map((el, i) => {
      const a = i * stagger;
      const t0 = a / total, t1 = Math.min(0.98, (a + enter) / total);
      const t3 = (total - rest) / total, t2 = Math.max(t1 + 0.001, (total - rest - exit) / total);
      return el.animate([
        { ...hidden(dist), offset: 0 }, { ...hidden(dist), offset: t0, easing }, { ...shown, offset: t1 }, { ...shown, offset: t2, easing: 'ease-in' },
        { ...hidden(-dist / 2), offset: Math.max(t2 + 0.001, t3) }, { ...hidden(-dist / 2), offset: 1 },
      ], { duration: total * 1000, iterations: Infinity });
    });
    return () => anims.forEach((a) => a.cancel());
  }, [m.easing, m.enter, m.exit, m.hold, m.stagger, m.intensity, text, replayKey]);
  return (
    <div ref={ref} className={`bs-kinetic ${className ?? ''}`} style={{ ...faceStyle(kit.typography.heading), fontSize: size, lineHeight: kit.typography.lineHeight }} aria-label={text}>
      {words.map((w, i) => <span key={i} className="w" aria-hidden="true">{w}&nbsp;</span>)}
    </div>
  );
}

export function KineticStage({ kit, text }: { kit: BrandKit; text: string }) {
  const [n, setN] = useState(0);
  return (
    <div className="bs-kin-stage">
      <KineticText kit={kit} text={text} size={34} replayKey={n} />
      <button type="button" className="bs-icon-btn" aria-label="Replay" title="Replay" onClick={() => setN((v) => v + 1)}><RotateCcw size={13} /></button>
    </div>
  );
}

/** A looping box that travels with the kit's easing: the "feel" of its motion in one dot. */
export function EaseDot({ kit, easing, duration, style }: { kit: BrandKit; easing?: string; duration?: number; style?: CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const ease = easing ?? kit.motionGuide.easing;
  const dur = duration ?? Math.max(0.2, kit.motionGuide.enter);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const hold = 0.5;
    const total = dur + hold * 2;
    const a = el.animate([
      { left: '0px', offset: 0 }, { left: '0px', offset: hold / total, easing: cssEase(ease) },
      { left: 'calc(100% - 20px)', offset: (hold + dur) / total }, { left: 'calc(100% - 20px)', offset: 1 },
    ], { duration: total * 1000, iterations: Infinity, direction: 'normal' });
    return () => a.cancel();
  }, [ease, dur]);
  return <span ref={ref} className="bs-easedot" style={style} />;
}

// ── transitions ───────────────────────────────────────────────────────────────

type Frame = Keyframe[];
/** How two frames of a mini demo move for one transition. `a` leaves, `b` arrives. */
export function transitionFrames(name: string): { a: Frame; b: Frame } {
  const n = name.toLowerCase();
  if (/cut|hard/.test(n)) return { a: [{ opacity: 1 }, { opacity: 0 }], b: [{ opacity: 0 }, { opacity: 1 }] };
  if (/push|slide|whip/.test(n)) return { a: [{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }], b: [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }] };
  if (/zoom|punch/.test(n)) return { a: [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.6)', opacity: 0 }], b: [{ transform: 'scale(0.7)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }] };
  if (/wipe|reveal|occlud|mask/.test(n)) return { a: [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], b: [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }] };
  if (/blur/.test(n)) return { a: [{ filter: 'blur(0)', opacity: 1 }, { filter: 'blur(10px)', opacity: 0 }], b: [{ filter: 'blur(10px)', opacity: 0 }, { filter: 'blur(0)', opacity: 1 }] };
  return { a: [{ opacity: 1 }, { opacity: 0 }], b: [{ opacity: 0 }, { opacity: 1 }] };
}

/** A tiny 16:9 loop: frame A becomes frame B the way this transition does it, at the kit's pace. */
export function TransitionDemo({ kit, name }: { kit: BrandKit; name: string }) {
  const a = useRef<HTMLDivElement>(null);
  const b = useRef<HTMLDivElement>(null);
  const m = kit.motionGuide;
  useEffect(() => {
    if (!a.current || !b.current || prefersReducedMotion()) return;
    const frames = transitionFrames(name);
    const dur = Math.max(0.2, m.enter) * 1000;
    const total = dur + 1400;
    const opts: KeyframeAnimationOptions = { duration: total, iterations: Infinity };
    // Each frame holds, plays the move in the middle, holds again, then snaps back for the next loop.
    const easing = /cut|hard/i.test(name) ? 'steps(1, jump-end)' : cssEase(m.easing);
    const wrap = (list: Frame): Keyframe[] => {
      const first = list[0], last = list[list.length - 1];
      const t0 = 600 / total, t1 = (600 + dur) / total;
      return [{ ...first, offset: 0 }, { ...first, offset: t0, easing }, { ...last, offset: t1 }, { ...last, offset: 1 }];
    };
    const anims = [a.current.animate(wrap(frames.a), opts), b.current.animate(wrap(frames.b), opts)];
    return () => anims.forEach((x) => x.cancel());
  }, [name, m.easing, m.enter]);
  const bg = kit.palette.ink, accent = kit.palette.accent, surface = kit.palette.surface;
  return (
    <div className="bs-tdemo" style={{ background: bg }}>
      <div ref={a} className="bs-tframe" style={{ background: surface }}><i style={{ background: kit.palette.muted }} /><i style={{ background: kit.palette.muted, width: '40%' }} /></div>
      <div ref={b} className="bs-tframe" style={{ background: accent }}><i style={{ background: bg }} /><i style={{ background: bg, width: '55%' }} /></div>
    </div>
  );
}
