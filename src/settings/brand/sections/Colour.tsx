import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useToast } from '../../../components/ui';
import { DAISY_THEMES, contrastRatio, type BrandColorToken, type BrandGradient, type ColorRole } from '../../../lib/brandKit';
import { contrastLevel, fixContrast, onColor, tintScale } from '../../../lib/brandKit/studio';
import { ColorPicker } from '../ColorPicker';
import { applyDaisyTheme } from '../helpers';
import { Field, Group, LinesInput, Popover, prefersReducedMotion, type SectionProps } from '../shared';

const ROLES: ColorRole[] = ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'muted', 'success', 'warning', 'error', 'info', 'neutral', 'custom'];

/** A big tactile swatch. When its colour changes, the new colour ripples out from the centre. */
/** What a swatch's contrast badge says: the text that sits on it (or the background it sits on), never the colour against itself. */
export function swatchContrast(token: BrandColorToken, bg: string, text: string): { label: string; ratio: number; level: string; title: string } {
  const pair = (fg: string, back: string, label: string, title: string) => { const ratio = contrastRatio(fg, back); return { label, ratio, level: contrastLevel(ratio), title: `${title} ${ratio}:1` }; };
  if (token.role === 'background' || token.role === 'surface') return pair(text, token.hex, 'Text', `Text colour on ${token.name}`);
  if (token.role === 'text' || token.role === 'muted') return pair(token.hex, bg, 'On bg', `${token.name} on the background`);
  return contrastRatio('#ffffff', token.hex) >= contrastRatio('#111111', token.hex) ? pair('#ffffff', token.hex, 'White text', 'White text on this colour') : pair('#111111', token.hex, 'Dark text', 'Dark text on this colour');
}

function Swatch({ token, onSelect, selected, bg, text }: { token: BrandColorToken; onSelect: (el: HTMLElement) => void; selected: boolean; bg: string; text: string }) {
  const [base, setBase] = useState(token.hex);
  const [ripple, setRipple] = useState<{ hex: string; key: number } | null>(null);
  const last = useRef(0);
  const key = useRef(0);
  useEffect(() => {
    if (token.hex === base && !ripple) return;
    if (token.hex === (ripple?.hex ?? base)) return;
    const now = performance.now();
    // While a colour is being dragged, ripples would pile up: only start one every 380 ms.
    if (prefersReducedMotion() || now - last.current < 380) { setBase(token.hex); setRipple(null); return; }
    last.current = now;
    if (ripple) setBase(ripple.hex);
    setRipple({ hex: token.hex, key: ++key.current });
  }, [token.hex]);
  const ink = onColor(ripple?.hex ?? base);
  const meaning = swatchContrast(token, bg, text);
  const sub = token.role.toLowerCase() !== token.name.toLowerCase() ? token.role : token.usage;
  const scale = useMemo(() => tintScale(token.hex), [token.hex]);
  return (
    <button type="button" className={`bs-sw role-${token.role}${selected ? ' on' : ''}`} onClick={(e) => onSelect(e.currentTarget)} style={{ background: base, color: ink }} aria-label={`${token.name} ${token.hex}, ${token.role}. Edit colour`} aria-haspopup="dialog">
      {ripple && <i key={ripple.key} className="bs-ripple" style={{ background: ripple.hex }} onAnimationEnd={() => { setBase(ripple.hex); setRipple(null); }} />}
      <span className="bs-sw-top"><b>{token.name}</b>{sub ? <em title={sub}>{sub}</em> : null}</span>
      <span className="bs-sw-bot">
        <code>{token.hex.toUpperCase()}</code>
        <span className="bs-sw-aa" title={meaning.title}>{meaning.label} {meaning.ratio} · {meaning.level}</span>
      </span>
      <span className="bs-sw-scale" aria-hidden="true">{scale.map((s) => <i key={s.label} style={{ background: s.hex }} />)}</span>
    </button>
  );
}

/** A dial: drag around the circle to set an angle in degrees. */
function AngleDial({ value, onChange }: { value: number; onChange: (deg: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: ReactPointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const deg = (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI + 90;
    onChange(Math.round(((deg % 360) + 360) % 360));
  };
  return (
    <div ref={ref} className="bs-dial" role="slider" aria-label="Gradient angle" aria-valuemin={0} aria-valuemax={360} aria-valuenow={value} tabIndex={0}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); }} onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e); }}
      onKeyDown={(e) => { const d = e.shiftKey ? 15 : 5; if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange((value + d) % 360); else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange((value + 360 - d) % 360); else return; e.preventDefault(); }}>
      <i className="bs-dial-needle" style={{ transform: `rotate(${value}deg)` }}><b /></i>
      <span>{value}°</span>
    </div>
  );
}

type Editing = { kind: 'token'; index: number } | { kind: 'stop'; gradient: number; stop: number } | null;

export function ColourBoard({ kit, onPatch, onReplace, onOpenStyles }: SectionProps & { onOpenStyles: () => void }) {
  const toast = useToast();
  const tokens = kit.colors.tokens;
  const gradients = kit.colors.gradients;
  const [editing, setEditing] = useState<Editing>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [gi, setGi] = useState(0);
  const bg = tokens.find((t) => t.role === 'background')?.hex ?? '#111111';
  const textHex = tokens.find((t) => t.role === 'text')?.hex ?? '#ffffff';
  const surface = tokens.find((t) => t.role === 'surface')?.hex ?? bg;
  const setTokens = (next: BrandColorToken[], soon = true) => onPatch('colors', { colors: { tokens: next } }, soon);
  const setToken = (i: number, change: Partial<BrandColorToken>) => setTokens(tokens.map((t, k) => (k === i ? { ...t, ...change } : t)));
  const setGradients = (next: BrandGradient[], soon = true) => onPatch('colors', { colors: { gradients: next } }, soon);
  const gradient = gradients[Math.min(gi, gradients.length - 1)];
  const gIndex = gradient ? gradients.indexOf(gradient) : -1;
  const setGradient = (change: Partial<BrandGradient>) => gradient && setGradients(gradients.map((g, k) => (k === gIndex ? { ...g, ...change } : g)));
  const quick = tokens.map((t) => t.hex);
  const edit = (next: Editing, el: HTMLElement) => { setEditing(next); setAnchor(el); };
  const done = () => { setEditing(null); setAnchor(null); };

  const rows = (['text', 'muted', 'primary', 'accent', 'secondary'] as ColorRole[]).flatMap((role) => { const t = tokens.find((x) => x.role === role); return t ? [t] : []; });
  const cols = (['background', 'surface', 'primary', 'accent'] as ColorRole[]).flatMap((role) => { const t = tokens.find((x) => x.role === role); return t ? [t] : []; });
  const keyScales = (['primary', 'secondary', 'accent', 'background'] as ColorRole[]).flatMap((role) => { const t = tokens.find((x) => x.role === role); return t ? [t] : []; });

  const stopAt = editing?.kind === 'stop' ? gradients[editing.gradient]?.stops[editing.stop] : undefined;
  const tokenAt = editing?.kind === 'token' ? tokens[editing.index] : undefined;

  return (
    <div className="bs-colour">
      <div className="bs-swatches">
        {tokens.map((t, i) => <Swatch key={`${i}`} token={t} bg={bg} text={textHex} selected={editing?.kind === 'token' && editing.index === i} onSelect={(el) => edit({ kind: 'token', index: i }, el)} />)}
        <button type="button" className="bs-sw add" onClick={() => setTokens([...tokens, { name: 'New colour', hex: tokens.find((t) => t.role === 'accent')?.hex ?? '#2d8ceb', role: 'custom', usage: '' }], false)}><Plus size={18} /><span>Add colour</span></button>
      </div>

      <Group label="Scales" hint="Nine shades of each key colour. Click one to copy it.">
        <div className="bs-scales">
          {keyScales.map((t) => (
            <div key={t.role} className="bs-scale-row">
              <span>{t.name}</span>
              <div>{tintScale(t.hex).map((s) => (
                <button key={s.label} type="button" className={s.base ? 'base' : ''} style={{ background: s.hex, color: onColor(s.hex) }} title={`${t.name} ${s.label} · ${s.hex}`} onClick={() => { void navigator.clipboard?.writeText(s.hex); toast({ tone: 'info', title: `${s.hex.toUpperCase()} copied`, timeout: 1400 }); }}>{s.label}</button>
              ))}</div>
            </div>
          ))}
        </div>
      </Group>

      {gradient && (
        <Group label="Gradients" hint="Drag the dial, click a stop to recolour it.">
          <div className="bs-grad">
            <div className="bs-grad-stage" style={{ backgroundImage: `linear-gradient(${gradient.angle}deg, ${gradient.stops.join(', ')})` }}>
              <span>{gradient.name}</span>
            </div>
            <div className="bs-grad-side">
              <div className="bs-grad-tabs" role="tablist" aria-label="Gradients">
                {gradients.map((g, i) => <button key={`${g.name}-${i}`} type="button" role="tab" aria-selected={i === gIndex} className={i === gIndex ? 'on' : ''} onClick={() => setGi(i)}><i style={{ background: `linear-gradient(${g.angle}deg, ${g.stops.join(', ')})` }} />{g.name}</button>)}
                <button type="button" className="bs-icon-btn" aria-label="New gradient" title="New gradient" onClick={() => { const p = tokens.find((t) => t.role === 'primary')?.hex ?? '#2d8ceb'; const a = tokens.find((t) => t.role === 'accent')?.hex ?? '#ff5d5d'; setGradients([...gradients, { name: `Gradient ${gradients.length + 1}`, angle: 135, stops: [p, a], usage: '' }], false); setGi(gradients.length); }}><Plus size={13} /></button>
              </div>
              <div className="bs-grad-row">
                <AngleDial value={gradient.angle} onChange={(angle) => setGradient({ angle })} />
                <div className="bs-grad-stops">
                  <span className="bs-label">Stops</span>
                  <div>
                    {gradient.stops.map((s, si) => (
                      <button key={si} type="button" className={`bs-stop${editing?.kind === 'stop' && editing.gradient === gIndex && editing.stop === si ? ' on' : ''}`} style={{ background: s }} aria-label={`Stop ${si + 1} ${s}`} onClick={(e) => edit({ kind: 'stop', gradient: gIndex, stop: si }, e.currentTarget)} />
                    ))}
                    {gradient.stops.length < 5 && <button type="button" className="bs-icon-btn" aria-label="Add stop" onClick={() => setGradient({ stops: [...gradient.stops, gradient.stops[gradient.stops.length - 1]] })}><Plus size={13} /></button>}
                    {gradient.stops.length > 2 && <button type="button" className="bs-icon-btn" aria-label="Remove last stop" onClick={() => setGradient({ stops: gradient.stops.slice(0, -1) })}><Trash2 size={12} /></button>}
                  </div>
                </div>
              </div>
              <div className="bs-two">
                <Field label="Name"><input className="bs-input" value={gradient.name} onChange={(e) => setGradient({ name: e.target.value })} /></Field>
                <Field label="Used for"><input className="bs-input" value={gradient.usage} placeholder="Hero backgrounds…" onChange={(e) => setGradient({ usage: e.target.value })} /></Field>
              </div>
              {gradients.length > 1 && <button type="button" className="bs-btn ghost danger small" onClick={() => { setGradients(gradients.filter((_, k) => k !== gIndex), false); setGi(0); }}><Trash2 size={12} /> Delete this gradient</button>}
            </div>
          </div>
        </Group>
      )}

      <Group label="Contrast" hint="Text on each background. AA is 4.5:1 for body text, AAA is 7:1.">
        <div className="bs-matrix" style={{ gridTemplateColumns: `112px repeat(${cols.length}, minmax(0, 1fr))` }}>
          <span />
          {cols.map((c) => <span key={c.role} className="bs-matrix-col"><i style={{ background: c.hex }} />on {c.name}</span>)}
          {[...rows.map((r) => ({ name: r.name, hex: r.hex, fixable: true as boolean, role: r.role as string })), { name: 'White', hex: '#ffffff', fixable: false, role: 'white' }, { name: 'Black', hex: '#000000', fixable: false, role: 'black' }].flatMap((r) => [
            <span key={`${r.role}-n`} className="bs-matrix-row"><i style={{ background: r.hex }} />{r.name}</span>,
            ...cols.map((c) => {
              if (c.hex.toLowerCase() === r.hex.toLowerCase()) return <span key={`${r.role}-${c.role}`} className="bs-cell same">same</span>;
              const ratio = contrastRatio(r.hex, c.hex);
              const level = contrastLevel(ratio);
              const fixed = level === 'fail' || level === 'AA large' ? fixContrast(r.hex, c.hex) : null;
              return (
                <span key={`${r.role}-${c.role}`} className={`bs-cell ${level === 'AAA' ? 'aaa' : level === 'AA' ? 'aa' : level === 'AA large' ? 'large' : 'fail'}`} style={{ background: c.hex, color: r.hex }}>
                  <b>Aa</b>
                  <span className="bs-cell-meta"><em>{level}</em> {ratio}:1</span>
                  {fixed && r.fixable && <button type="button" className="bs-fix" title={`Nudge ${r.name} to ${contrastRatio(fixed, c.hex)}:1 on ${c.name}`} onClick={() => { const i = tokens.findIndex((t) => t.role === r.role); if (i >= 0) setToken(i, { hex: fixed }); }}>Fix</button>}
                </span>
              );
            }),
          ])}
        </div>
      </Group>

      <div className="bs-two">
        <Group label="Recolour" hint="Swap the whole palette for a ready-made theme.">
          <div className="bs-inline">
            <select className="bs-input" aria-label="Recolour from a DaisyUI theme" value={kit.colors.daisyTheme ?? ''} onChange={(e) => { if (e.target.value) onReplace(applyDaisyTheme(kit, e.target.value)); }}>
              <option value="">{kit.colors.daisyTheme ? kit.colors.daisyTheme : 'Choose a DaisyUI theme…'}</option>
              {DAISY_THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button type="button" className="bs-btn" onClick={onOpenStyles}>Browse styles</button>
          </div>
        </Group>
        <Group label="Colour rules" hint="One per line.">
          <LinesInput value={kit.colors.rules} rows={3} onChange={(rules) => onPatch('colors', { colors: { rules } })} />
        </Group>
      </div>

      {editing && anchor && (tokenAt || stopAt) && (
        <Popover anchor={anchor} onClose={done} width={288} label={tokenAt ? `Edit ${tokenAt.name}` : 'Edit gradient stop'}>
          {tokenAt && editing.kind === 'token' ? (
            <>
              <ColorPicker hex={tokenAt.hex} swatches={quick} onChange={(hex) => setToken(editing.index, { hex })} />
              <div className="bs-pop-form">
                <input className="bs-input" value={tokenAt.name} aria-label="Colour name" onChange={(e) => setToken(editing.index, { name: e.target.value })} />
                <select className="bs-input" value={tokenAt.role} aria-label="Role" onChange={(e) => setToken(editing.index, { role: e.target.value as ColorRole })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
                <input className="bs-input wide" value={tokenAt.usage} placeholder="Where it is used" aria-label="Usage" onChange={(e) => setToken(editing.index, { usage: e.target.value })} />
              </div>
              <div className="bs-pop-scale" aria-label="Shades">{tintScale(tokenAt.hex).map((s) => <button key={s.label} type="button" style={{ background: s.hex }} title={`${s.label} ${s.hex}`} aria-label={`Use ${s.label}`} onClick={() => setToken(editing.index, { hex: s.hex })} />)}</div>
              <div className="bs-pop-foot">
                <span>{contrastRatio(tokenAt.hex, bg)}:1 on background · {contrastRatio(tokenAt.hex, surface)}:1 on surface</span>
                <button type="button" className="bs-btn ghost danger small" disabled={tokens.length <= 4} title={tokens.length <= 4 ? 'A kit keeps at least four colours' : 'Delete this colour'} onClick={() => { setTokens(tokens.filter((_, k) => k !== editing.index), false); done(); }}><Trash2 size={12} /> Delete</button>
              </div>
            </>
          ) : stopAt && editing.kind === 'stop' ? (
            <ColorPicker hex={stopAt} swatches={quick} onChange={(hex) => setGradients(gradients.map((g, k) => (k === editing.gradient ? { ...g, stops: g.stops.map((s, si) => (si === editing.stop ? hex : s)) } : g)))} />
          ) : null}
        </Popover>
      )}
    </div>
  );
}
