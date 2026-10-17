import { ArrowLeft, Plus, X } from 'lucide-react';
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { EASE_PRESETS, bezierToEasing, easingToBezier, type Bezier } from '../../../lib/brandKit/studio';
import { EaseDot, TransitionDemo } from '../Kinetic';
import { ChipsInput, Group, LinesInput, Segmented, Slider, tokenHex, type SectionProps } from '../shared';

const SIZE = 248, PAD = 24, Y_MIN = -0.5, Y_MAX = 1.5;
const px = (x: number) => PAD + x * (SIZE - PAD * 2);
const py = (y: number) => PAD + (1 - (y - Y_MIN) / (Y_MAX - Y_MIN)) * (SIZE - PAD * 2);

/** Drag the two handles; the brand's easing is rewritten as a cubic-bezier. */
function BezierEditor({ curve, onChange, accent }: { curve: Bezier; onChange: (c: Bezier) => void; accent: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = (which: 0 | 1) => (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = svg.current!.getBoundingClientRect();
      const sx = ((ev.clientX - r.left) / r.width) * SIZE, sy = ((ev.clientY - r.top) / r.height) * SIZE;
      const x = Math.min(1, Math.max(0, (sx - PAD) / (SIZE - PAD * 2)));
      const y = Y_MIN + (1 - (sy - PAD) / (SIZE - PAD * 2)) * (Y_MAX - Y_MIN);
      const next: Bezier = [...curve] as Bezier;
      next[which * 2] = x;
      next[which * 2 + 1] = Math.min(Y_MAX, Math.max(Y_MIN, y));
      onChange(next);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const nudge = (which: 0 | 1) => (e: React.KeyboardEvent) => {
    const d = e.shiftKey ? 0.1 : 0.02;
    const next: Bezier = [...curve] as Bezier;
    if (e.key === 'ArrowRight') next[which * 2] = Math.min(1, next[which * 2] + d);
    else if (e.key === 'ArrowLeft') next[which * 2] = Math.max(0, next[which * 2] - d);
    else if (e.key === 'ArrowUp') next[which * 2 + 1] = Math.min(Y_MAX, next[which * 2 + 1] + d);
    else if (e.key === 'ArrowDown') next[which * 2 + 1] = Math.max(Y_MIN, next[which * 2 + 1] - d);
    else return;
    e.preventDefault();
    onChange(next);
  };
  const [a, b, c, d] = curve;
  return (
    <svg ref={svg} className="bs-bezier" viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" aria-label="Easing curve editor">
      <rect x={px(0)} y={py(1)} width={px(1) - px(0)} height={py(0) - py(1)} className="bs-bz-box" />
      <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} className="bs-bz-diag" />
      <line x1={px(0)} y1={py(0)} x2={px(a)} y2={py(b)} className="bs-bz-arm" style={{ stroke: accent }} />
      <line x1={px(1)} y1={py(1)} x2={px(c)} y2={py(d)} className="bs-bz-arm" style={{ stroke: accent }} />
      <path d={`M ${px(0)} ${py(0)} C ${px(a)} ${py(b)}, ${px(c)} ${py(d)}, ${px(1)} ${py(1)}`} className="bs-bz-curve" style={{ stroke: accent }} />
      <circle cx={px(0)} cy={py(0)} r={3.5} className="bs-bz-end" /><circle cx={px(1)} cy={py(1)} r={3.5} className="bs-bz-end" />
      <circle cx={px(a)} cy={py(b)} r={8} className="bs-bz-handle" style={{ fill: accent }} tabIndex={0} role="slider" aria-label="First control point" aria-valuetext={`${a.toFixed(2)}, ${b.toFixed(2)}`} onPointerDown={drag(0)} onKeyDown={nudge(0)} />
      <circle cx={px(c)} cy={py(d)} r={8} className="bs-bz-handle" style={{ fill: accent }} tabIndex={0} role="slider" aria-label="Second control point" aria-valuetext={`${c.toFixed(2)}, ${d.toFixed(2)}`} onPointerDown={drag(1)} onKeyDown={nudge(1)} />
    </svg>
  );
}

const TRANSITION_IDEAS = ['cut', 'dissolve', 'push', 'wipe', 'zoom-punch', 'occluder', 'slide', 'blur', 'whip'];

export function MotionBoard({ kit, onPatch }: SectionProps) {
  const m = kit.motionGuide;
  const accent = tokenHex(kit, 'accent', '#2d8ceb');
  const curve = easingToBezier(m.easing) ?? [0.16, 1, 0.3, 1];
  const setCurve = (c: Bezier) => onPatch('motion', { easing: bezierToEasing(c) });
  const total = m.enter + m.hold + m.exit + m.stagger * 3;
  const pct = (s: number) => `${(s / total) * 100}%`;
  const move = (i: number, dir: -1 | 1) => { const list = [...m.transitions]; const j = i + dir; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; onPatch('motion', { transitions: list }); };
  return (
    <div className="bs-motion">
      <div className="bs-mo-top">
        <div className="bs-mo-curve">
          <BezierEditor curve={curve} onChange={setCurve} accent={accent} />
          <div className="bs-mo-presets">
            {EASE_PRESETS.map((p) => <button key={p.name} type="button" className={bezierToEasing(p.curve) === bezierToEasing(curve) ? 'on' : ''} onClick={() => setCurve(p.curve)}>{p.name}</button>)}
          </div>
          <code className="bs-mo-code">{bezierToEasing(curve)}</code>
        </div>
        <div className="bs-mo-feel">
          <Group label="The feel" hint="A dot and a box replay the curve on loop.">
            <div className="bs-track"><EaseDot kit={kit} /></div>
            <div className="bs-track thick"><EaseDot kit={kit} style={{ borderRadius: `${Math.round(kit.layout.radius * 400)}px`, width: 20, height: 20 }} /></div>
          </Group>
          <Group label="Intensity">
            <Segmented label="Motion intensity" value={m.intensity} onChange={(intensity) => onPatch('motion', { intensity })} options={[{ value: 'calm', label: 'Calm' }, { value: 'balanced', label: 'Balanced' }, { value: 'energetic', label: 'Energetic' }]} />
          </Group>
          <Group label="Timing" hint={`${total.toFixed(2)} s for four staggered items`}>
            <div className="bs-timing">
              <Slider label="Enter" value={m.enter} min={0.1} max={2} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(enter) => onPatch('motion', { enter })} />
              <Slider label="Hold" value={m.hold} min={0.2} max={6} step={0.1} format={(v) => `${v.toFixed(1)} s`} onChange={(hold) => onPatch('motion', { hold })} />
              <Slider label="Exit" value={m.exit} min={0.1} max={2} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(exit) => onPatch('motion', { exit })} />
              <Slider label="Stagger" value={m.stagger} min={0} max={0.4} step={0.01} format={(v) => `${v.toFixed(2)} s`} onChange={(stagger) => onPatch('motion', { stagger })} />
            </div>
            <div className="bs-timeline" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="bs-tl-row">
                  <i className="bs-tl-enter" style={{ left: pct(i * m.stagger), width: pct(m.enter), background: accent }} />
                  <i className="bs-tl-hold" style={{ left: pct(i * m.stagger + m.enter), width: pct(m.hold) }} />
                  <i className="bs-tl-exit" style={{ left: pct(i * m.stagger + m.enter + m.hold), width: pct(m.exit), background: accent }} />
                </div>
              ))}
              <b className="bs-tl-head" style={{ animationDuration: `${Math.max(1.5, total)}s` }} />
              <div className="bs-tl-legend"><span>enter</span><span>hold</span><span>exit</span></div>
            </div>
          </Group>
        </div>
      </div>

      <Group label="Transitions" hint="In the order the brand reaches for them. Each one loops at this brand's pace.">
        <div className="bs-trans">
          {m.transitions.map((t, i) => (
            <figure key={`${t}-${i}`} className="bs-trans-card">
              <TransitionDemo kit={kit} name={t} />
              <figcaption>
                <b>{i + 1}. {t}</b>
                <span>
                  {i > 0 && <button type="button" className="bs-icon-btn" aria-label={`Move ${t} earlier`} title="Move earlier" onClick={() => move(i, -1)}><ArrowLeft size={12} /></button>}
                  <button type="button" className="bs-icon-btn" aria-label={`Remove ${t}`} title="Remove" onClick={() => onPatch('motion', { transitions: m.transitions.filter((_, k) => k !== i) })}><X size={12} /></button>
                </span>
              </figcaption>
            </figure>
          ))}
          <div className="bs-trans-add">
            {TRANSITION_IDEAS.filter((t) => !m.transitions.includes(t)).map((t) => <button key={t} type="button" onClick={() => onPatch('motion', { transitions: [...m.transitions, t] })}><Plus size={11} /> {t}</button>)}
          </div>
        </div>
      </Group>

      <div className="bs-two">
        <Group label="Principles" hint="One per line."><LinesInput value={m.principles} rows={4} onChange={(principles) => onPatch('motion', { principles })} /></Group>
        <div className="bs-stack">
          <Group label="Preferred React Bits"><ChipsInput value={m.preferredBits} onChange={(preferredBits) => onPatch('motion', { preferredBits })} placeholder="split-text…" /></Group>
          <Group label="Preferred templates"><ChipsInput value={m.preferredTemplates} onChange={(preferredTemplates) => onPatch('motion', { preferredTemplates })} placeholder="hook-promise…" /></Group>
        </div>
      </div>
    </div>
  );
}
