// Settings › Brand kit › Guideline: the kit's guideline drawn the way a designer would hand it over —
// colour usage, the type scale in its real fonts, every layout with its zones, and every signature
// move as a filmstrip of frames with the keys under it. It is the same data the AI reads
// (get_brand_guideline) and the `brand-*` motion templates render.
import { RotateCcw } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { guidelineOf, stateAt } from '../lib/brandKit';
import type { BrandKit, BrandLayoutSpec, BrandMove, MoveElement } from '../lib/brandKit';

type Props = { kit: BrandKit; onReset: () => void };

const FRAME_W = 176;

function frameBox(aspect: string, width = FRAME_W) {
  const [a, b] = aspect.split(':').map(Number);
  return { width, height: Math.round((width * b) / a) };
}

/** Where each role sits in a filmstrip frame (fractions), so a move reads without a layout. */
const SPOT: Record<string, { x: number; y: number; w: number; h: number }> = {
  kicker: { x: 0.3, y: 0.28, w: 0.4, h: 0.06 },
  headline: { x: 0.14, y: 0.36, w: 0.72, h: 0.18 },
  'accent-bar': { x: 0.44, y: 0.57, w: 0.12, h: 0.02 },
  subhead: { x: 0.22, y: 0.62, w: 0.56, h: 0.07 },
  body: { x: 0.2, y: 0.62, w: 0.6, h: 0.14 },
  panel: { x: 0.06, y: 0.66, w: 0.44, h: 0.2 },
  label: { x: 0.28, y: 0.64, w: 0.44, h: 0.07 },
  number: { x: 0.25, y: 0.3, w: 0.5, h: 0.24 },
  logo: { x: 0.42, y: 0.3, w: 0.16, h: 0.2 },
  cta: { x: 0.36, y: 0.62, w: 0.28, h: 0.1 },
  caption: { x: 0.2, y: 0.78, w: 0.6, h: 0.08 },
  background: { x: 0, y: 0, w: 1, h: 1 },
  outgoing: { x: 0, y: 0, w: 1, h: 1 },
  incoming: { x: 0, y: 0, w: 1, h: 1 },
  shape: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
};

function ElementBox({ element, frame, width, colors, fonts, lowerThird }: { element: MoveElement; frame: number; width: number; colors: Record<string, string>; fonts: { display: string; body: string }; lowerThird: boolean }) {
  const s = stateAt(element, frame);
  const box = lowerThird && (element.role === 'headline' || element.role === 'subhead')
    ? element.role === 'headline' ? { x: 0.09, y: 0.68, w: 0.38, h: 0.08 } : { x: 0.09, y: 0.77, w: 0.3, h: 0.05 }
    : lowerThird && element.role === 'accent-bar' ? { x: 0.06, y: 0.66, w: 0.012, h: 0.2 } : SPOT[element.role] ?? SPOT.shape;
  const k = width / 1920;
  const height = width * (9 / 16);
  const style: CSSProperties = {
    position: 'absolute',
    left: box.x * width,
    top: box.y * height,
    width: box.w * width,
    height: box.h * height,
    opacity: s.opacity,
    transform: `translate(${s.x * k * 2}px, ${s.y * k * 2}px) scale(${s.scale}) rotate(${s.rotate}deg)`,
    filter: s.blur > 0 ? `blur(${Math.min(6, s.blur * k * 2)}px)` : undefined,
    clipPath: s.clip < 1 ? `inset(0 ${(1 - s.clip) * 100}% 0 0)` : undefined,
    transformOrigin: element.role === 'panel' || element.role === 'accent-bar' ? 'left center' : 'center',
    display: 'flex',
    alignItems: 'center',
    justifyContent: element.role === 'panel' ? 'flex-start' : 'center',
    overflow: 'hidden',
    borderRadius: 3,
  };
  switch (element.role) {
    case 'background':
      return <div style={{ ...style, background: `linear-gradient(135deg, ${colors.background}, ${colors.primary})` }} />;
    case 'outgoing':
      return <div style={{ ...style, background: '#4a4a4a' }}><span style={{ fontSize: 9, color: '#ddd' }}>A</span></div>;
    case 'incoming':
      return <div style={{ ...style, background: '#777' }}><span style={{ fontSize: 9, color: '#fff' }}>B</span></div>;
    case 'panel':
      return <div style={{ ...style, background: colors.surface }} />;
    case 'accent-bar':
      return <div style={{ ...style, background: colors.accent }} />;
    case 'logo':
      return <div style={{ ...style, background: colors.accent, borderRadius: '50%', aspectRatio: '1', width: box.h * height }} />;
    case 'cta':
      return <div style={{ ...style, background: colors.accent, borderRadius: 99, fontSize: 7, color: colors.background, fontWeight: 700 }}>CTA</div>;
    case 'number':
      return <div style={{ ...style, color: colors.accent, fontFamily: fonts.display, fontWeight: 800, fontSize: box.h * height * 0.8 }}>{Math.round(87 * Math.min(1, frame / Math.max(1, element.keys[element.keys.length - 1]?.frame ?? 1)))}%</div>;
    case 'kicker':
    case 'label':
      return <div style={{ ...style, color: colors.accent, fontFamily: fonts.body, fontWeight: 700, fontSize: 7, letterSpacing: `${s.tracking / 100}em` }}>LABEL</div>;
    case 'subhead':
    case 'body':
    case 'caption':
      return <div style={{ ...style, color: colors.muted, fontFamily: fonts.body, fontSize: 8 }}>{element.role === 'caption' ? 'caption line' : 'Subhead line'}</div>;
    default:
      return <div style={{ ...style, color: colors.text, fontFamily: fonts.display, fontWeight: 800, fontSize: box.h * height * 0.55, whiteSpace: 'nowrap', justifyContent: lowerThird ? 'flex-start' : 'center' }}>{element.name.startsWith('Word') ? element.name.replace('Word ', 'W') : lowerThird ? 'Name' : 'Headline'}</div>;
  }
}

function MoveStrip({ move, colors, fonts }: { move: BrandMove; colors: Record<string, string>; fonts: { display: string; body: string } }) {
  const [open, setOpen] = useState(false);
  const count = 6;
  const frames = Array.from({ length: count }, (_, i) => Math.round((move.frames * i) / (count - 1)));
  const lowerThird = move.id.startsWith('lower-third');
  const height = Math.round(FRAME_W * (9 / 16));
  return (
    <div className="bk-move">
      <div className="bk-move-head">
        <strong>{move.name}</strong>
        <small>{move.frames} frames · {(move.frames / move.fps).toFixed(2)} s @ {move.fps} fps</small>
      </div>
      <p className="bk-move-desc">{move.description} <span className="muted">Use: {move.use}</span></p>
      <div className="bk-filmstrip">
        {frames.map((frame) => (
          <figure key={frame} className="bk-frame">
            <div className="bk-frame-canvas" style={{ width: FRAME_W, height, background: colors.background }}>
              {move.elements.map((element) => (
                <ElementBox key={element.name} element={element} frame={frame} width={FRAME_W} colors={colors} fonts={fonts} lowerThird={lowerThird} />
              ))}
            </div>
            <figcaption>f{frame}</figcaption>
          </figure>
        ))}
      </div>
      <button type="button" className="btn btn-ghost btn-small" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} keys</button>
      {open && (
        <table className="bk-keys">
          <thead><tr><th>Element</th><th>Frame</th><th>State</th><th>Ease</th></tr></thead>
          <tbody>
            {move.elements.flatMap((element) =>
              element.keys.map((key, i) => (
                <tr key={`${element.name}-${i}`}>
                  <td>{i === 0 ? element.name : ''}</td>
                  <td>f{key.frame}</td>
                  <td>{Object.entries(key.state).map(([prop, value]) => `${prop} ${typeof value === 'number' ? +value.toFixed(3) : value}`).join(' · ')}{key.note ? ` — ${key.note}` : ''}</td>
                  <td>{key.ease ?? ''}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function LayoutFrame({ layout, colors }: { layout: BrandLayoutSpec; colors: Record<string, string> }) {
  const box = frameBox(layout.aspect, layout.aspect === '9:16' ? 90 : FRAME_W);
  return (
    <figure className="bk-layout">
      <div className="bk-frame-canvas" style={{ ...box, background: colors.background }}>
        {layout.zones.map((zone) => (
          <div
            key={`${zone.role}-${zone.name}`}
            className="bk-zone"
            title={`${zone.name} — ${Math.round(zone.x * 100)}%, ${Math.round(zone.y * 100)}%, ${Math.round(zone.w * 100)}×${Math.round(zone.h * 100)}%${zone.type ? ` · ${zone.type}` : ''}${zone.notes ? ` · ${zone.notes}` : ''}`}
            style={{
              left: zone.x * box.width, top: zone.y * box.height, width: Math.max(2, zone.w * box.width), height: Math.max(2, zone.h * box.height),
              borderColor: zone.role === 'accent-bar' || zone.role === 'cta' ? colors.accent : `${colors.text}88`,
              background: zone.role === 'panel' ? `${colors.surface}cc` : zone.role === 'accent-bar' ? colors.accent : 'transparent',
              textAlign: zone.align,
            }}
          >
            <span style={{ color: colors.text }}>{zone.name}</span>
          </div>
        ))}
      </div>
      <figcaption>{layout.name}<br /><span className="muted">{layout.use}</span></figcaption>
    </figure>
  );
}

export function BrandGuidelineView({ kit, onReset }: Props) {
  const g = useMemo(() => guidelineOf(kit), [kit]);
  const colors = Object.fromEntries(g.color.roles.map((r) => [r.role, r.hex]));
  const fonts = { display: kit.typography.display.family, body: kit.typography.body.family };
  const [aspect, setAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const aspects = [...new Set(g.layouts.map((l) => l.aspect))];
  return (
    <div className="bk-guideline">
      <div className="bk-guideline-head">
        <p>{g.summary}</p>
        <div>
          <span className={`bk-badge ${g.source}`}>{g.source === 'derived' ? 'Derived from the kit' : g.source === 'ai' ? 'Refined by the AI' : 'Edited'}</span>
          {g.source !== 'derived' && <button type="button" className="btn btn-ghost btn-small" onClick={onReset} title="Drop the refinements and derive the guideline from the kit again"><RotateCcw size={12} /> Reset</button>}
        </div>
      </div>

      <h5>Colour usage <small>{g.color.ratio}</small></h5>
      <div className="bk-ratio">
        <span style={{ flex: 60, background: colors.background }} />
        <span style={{ flex: 30, background: colors.surface }} />
        <span style={{ flex: 10, background: colors.accent }} />
      </div>
      <div className="bk-roles">
        {g.color.roles.map((role) => (
          <div key={role.role} className="bk-role"><i style={{ background: role.hex }} /><strong>{role.role}</strong><code>{role.hex}</code><small>{role.use}</small></div>
        ))}
      </div>
      <ul className="bk-rules">{g.color.rules.map((r) => <li key={r}>{r}</li>)}</ul>

      <h5>Type scale <small>sizes at 1080p</small></h5>
      <div className="bk-typescale" style={{ background: colors.background }}>
        {g.typeScale.map((step) => (
          <div key={step.role} className="bk-typestep">
            <span className="bk-typestep-meta">{step.role} · {step.family} {step.weight} · {step.size}px · lh {step.lineHeight} · {step.tracking}/100em · max {step.maxWordsPerLine} words/line</span>
            <span style={{ fontFamily: step.family, fontWeight: step.weight, fontSize: Math.max(10, Math.min(40, step.size * 0.34)), color: step.color, textTransform: step.transform, letterSpacing: `${step.tracking / 100}em`, lineHeight: step.lineHeight }}>
              {step.role === 'display' ? kit.name : step.role === 'label' ? 'LABEL TEXT' : 'The quick brown fox jumps'}
            </span>
          </div>
        ))}
      </div>

      <h5>Motion <small>{g.motion.fps} fps</small></h5>
      <div className="bk-motion-facts">
        <span>Enter <b>{g.motion.timing.enter}s</b> · {g.motion.easing.enter}</span>
        <span>Exit <b>{g.motion.timing.exit}s</b> · {g.motion.easing.exit}</span>
        <span>Hold <b>{g.motion.timing.hold}s</b></span>
        <span>Stagger <b>{g.motion.timing.stagger}s</b> · words <b>{g.motion.timing.wordStagger}s</b></span>
        <span>Travel <b>{g.motion.distance}px</b> · blur <b>{g.motion.blur}px</b> · overshoot <b>{Math.round(g.motion.overshoot * 100)}%</b></span>
      </div>
      <ul className="bk-rules">{g.motion.principles.map((r) => <li key={r}>{r}</li>)}</ul>

      <h5>Signature moves <small>frame by frame</small></h5>
      {g.moves.map((move) => <MoveStrip key={move.id} move={move} colors={colors} fonts={fonts} />)}

      <h5>
        Layouts
        <span className="bk-aspects">{aspects.map((a) => <button key={a} type="button" className={`btn btn-small ${aspect === a ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setAspect(a as typeof aspect)}>{a}</button>)}</span>
      </h5>
      <div className="bk-layouts">{g.layouts.filter((l) => l.aspect === aspect).map((layout) => <LayoutFrame key={layout.id} layout={layout} colors={colors} />)}</div>

      <h5>Scene recipes</h5>
      <div className="bk-recipes">
        {g.recipes.map((r) => (
          <div key={r.id} className="bk-recipe">
            <strong>{r.name}</strong> <small>{r.template ?? ''}</small>
            <p>{r.use} {r.copy}</p>
            <small className="muted">layout {r.layout} · moves {r.moves.join(' → ')} · hold {r.hold.toFixed(1)}s · background: {r.background.note}</small>
          </div>
        ))}
      </div>

      <div className="bk-dodont">
        <div><h5>Do</h5><ul>{g.dos.map((d) => <li key={d}>{d}</li>)}</ul></div>
        <div><h5>Don't</h5><ul>{g.donts.map((d) => <li key={d}>{d}</li>)}</ul></div>
      </div>
    </div>
  );
}
