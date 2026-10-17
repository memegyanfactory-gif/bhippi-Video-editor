import type { CSSProperties } from 'react';
import type { BrandKit, Corner } from '../../../lib/brandKit';
import { onColor } from '../../../lib/brandKit/studio';
import { SAMPLE_FRAMES } from '../helpers';
import { ChipsInput, Field, Group, LinesInput, LogoMark, Segmented, Slider, faceStyle, tokenHex, type SectionProps } from '../shared';
import { CornerPicker } from './Logo';

type LT = BrandKit['layout']['lowerThird'];
type Cap = BrandKit['layout']['captions'];
const LT_ORDER: LT[] = ['bottom-left', 'bottom-center', 'bottom-right'];
const CAP_ORDER: Cap[] = ['bottom-center', 'top-center', 'center', 'lower-third-side'];
const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];

const FRAMES = [
  { id: '16:9', w: 16, h: 9, src: SAMPLE_FRAMES[1] },
  { id: '9:16', w: 9, h: 16, src: SAMPLE_FRAMES[0] },
  { id: '1:1', w: 1, h: 1, src: SAMPLE_FRAMES[2] },
];

function LayoutFrame({ kit, aspect, onPatch }: { kit: BrandKit; aspect: (typeof FRAMES)[number]; onPatch: SectionProps['onPatch'] }) {
  const L = kit.layout;
  const accent = tokenHex(kit, 'accent', '#2d8ceb');
  const surface = tokenHex(kit, 'surface', '#222');
  const fg = tokenHex(kit, 'text', '#fff');
  const portrait = aspect.h > aspect.w;
  const m = `calc(${L.safeMargin} * 100cqmin)`;
  const logoPos: CSSProperties = L.logoBug === 'center' ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' } : { [L.logoBug.startsWith('top') ? 'top' : 'bottom']: m, [L.logoBug.endsWith('left') ? 'left' : 'right']: m };
  const capLift = L.captions === 'bottom-center' ? '16cqmin' : '0cqmin';
  const ltPos: CSSProperties = {
    bottom: `calc(${m} + ${capLift})`,
    ...(L.lowerThird === 'bottom-left' ? { left: m } : L.lowerThird === 'bottom-right' ? { right: m } : { left: '50%', transform: 'translateX(-50%)' }),
    width: portrait ? '70cqw' : '46cqw',
    borderRadius: `calc(${L.radius} * 100cqmin)`,
  };
  const capSide = L.lowerThird === 'bottom-right' ? { left: m } : { right: m };
  const capPos: CSSProperties = L.captions === 'bottom-center' ? { bottom: m, left: '50%', transform: 'translateX(-50%)' } : L.captions === 'top-center' ? { top: m, left: '50%', transform: 'translateX(-50%)' } : L.captions === 'center' ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' } : { bottom: m, ...capSide };
  const next = <T,>(list: T[], v: T): T => list[(list.indexOf(v) + 1) % list.length];
  return (
    <figure className="bs-lframe-wrap" style={{ aspectRatio: `${aspect.w} / ${aspect.h}` }}>
      <div className="bs-lframe" style={{ backgroundImage: `linear-gradient(#0000002e, #0000004d), url(${aspect.src})` }}>
        <div className="bs-safe" style={{ inset: m }} />
        {CORNERS.filter((c) => c !== 'center').map((c) => (
          <button key={c} type="button" className={`bs-corner-hit ${c}${L.logoBug === c ? ' on' : ''}`} aria-label={`Put the logo bug ${c}`} title={`Logo bug: ${c}`} style={{ [c.startsWith('top') ? 'top' : 'bottom']: m, [c.endsWith('left') ? 'left' : 'right']: m }} onClick={() => onPatch('layout', { logoBug: c })} />
        ))}
        <div className="bs-lbug" style={logoPos}><LogoMark kit={kit} height={22} /></div>
        <button type="button" className="bs-lthird" style={{ ...ltPos, background: surface, color: fg }} title="Lower third: click to move it" onClick={() => onPatch('layout', { lowerThird: next(LT_ORDER, L.lowerThird) })}>
          <i style={{ background: accent }} />
          <span><b style={faceStyle(kit.typography.heading)}>{kit.name}</b><small style={{ fontFamily: kit.typography.body.family }}>{kit.tagline || kit.industry || 'Lower third'}</small></span>
        </button>
        <button type="button" className="bs-lcap" style={{ ...capPos, background: accent, color: onColor(accent), ...faceStyle(kit.typography.caption), textTransform: kit.typography.caption.transform }} title="Captions: click to move them" onClick={() => onPatch('layout', { captions: next(CAP_ORDER, L.captions) })}>Captions land here</button>
      </div>
      <figcaption>{aspect.id}</figcaption>
    </figure>
  );
}

export function LayoutBoard({ kit, onPatch }: SectionProps) {
  const L = kit.layout;
  return (
    <div className="bs-layout">
      <div className="bs-lframes">
        {FRAMES.map((f) => <LayoutFrame key={f.id} kit={kit} aspect={f} onPatch={onPatch} />)}
      </div>
      <p className="bs-hint">Click a corner to place the logo bug, the lower third or the captions to move them. The dashed line is the safe area.</p>
      <div className="bs-layout-controls">
        <Slider label="Safe margin" value={L.safeMargin} min={0.02} max={0.12} step={0.005} format={(v) => `${(v * 100).toFixed(1)}%`} onChange={(safeMargin) => onPatch('layout', { safeMargin })} />
        <Slider label="Corner radius" value={L.radius} min={0} max={0.08} step={0.002} format={(v) => `${(v * 100).toFixed(1)}%`} onChange={(radius) => onPatch('layout', { radius })} />
        <Slider label="Grid columns" value={L.grid} min={4} max={16} step={1} format={(v) => `${v}`} onChange={(grid) => onPatch('layout', { grid })} />
        <div className="bs-field"><span>Logo bug</span><CornerPicker label="Logo bug corner" value={L.logoBug} onChange={(logoBug) => onPatch('layout', { logoBug })} /></div>
        <div className="bs-field"><span>Lower third</span><Segmented label="Lower third" value={L.lowerThird} onChange={(lowerThird) => onPatch('layout', { lowerThird })} options={[{ value: 'bottom-left', label: 'Left' }, { value: 'bottom-center', label: 'Centre' }, { value: 'bottom-right', label: 'Right' }]} /></div>
        <div className="bs-field"><span>Captions</span><Segmented label="Captions" value={L.captions} onChange={(captions) => onPatch('layout', { captions })} options={[{ value: 'bottom-center', label: 'Bottom' }, { value: 'top-center', label: 'Top' }, { value: 'center', label: 'Centre' }, { value: 'lower-third-side', label: 'Side' }]} /></div>
      </div>
      <div className="bs-two">
        <Group label="Aspect ratios"><ChipsInput value={L.aspects} onChange={(aspects) => onPatch('layout', { aspects })} placeholder="16:9" suggestions={['16:9', '9:16', '1:1', '4:5']} /></Group>
        <Field label="Layout rules" hint="one per line"><LinesInput value={L.rules} rows={3} onChange={(rules) => onPatch('layout', { rules })} /></Field>
      </div>
    </div>
  );
}
