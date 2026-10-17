// Step 5 and 6: three directions shown large, then the refine screen for the one that was chosen.

import { ArrowRight, Check, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import type { BrandKit } from '../../../lib/brandKit';
import { buildDirectionKit, ensureContrast, motionFor, type Direction, type RefineChoice } from '../../../lib/brandKit/directions';
import { Stage, prefersReducedMotion, useReplay, type StageSpec } from './Stage';

/** What a direction looks like on the stage for a refine choice. */
export function specOfDirection(d: Direction, choice: RefineChoice, name: string): StageSpec {
  const pal = d.palettes[Math.min(choice.palette, d.palettes.length - 1)];
  const pair = d.pairings[Math.min(choice.pairing, d.pairings.length - 1)];
  const m = motionFor(choice.energy);
  return {
    name,
    colors: pal.colors,
    display: { family: pair.display, weight: pair.displayWeight, transform: pair.transform, letterSpacing: pair.tracking },
    body: pair.body,
    motion: { easing: m.easing, enter: m.enter, stagger: m.stagger, intensity: m.intensity },
    logo: d.logo.generated ? null : { svg: d.logo.svg, dataUrl: d.logo.dataUrl },
    wordmark: d.wordmark,
    tagline: d.voice.samples[0],
  };
}

export const DEFAULT_CHOICE = (d: Direction): RefineChoice => ({ palette: 0, pairing: 0, energy: d.energy });

const swatchKeys = ['bg', 'surface', 'primary', 'accent', 'accent2', 'text'] as const;

function LogoTiles({ kit, d, choice, name }: { kit: BrandKit; d: Direction; choice: RefineChoice; name: string }) {
  const pal = d.palettes[Math.min(choice.palette, d.palettes.length - 1)].colors;
  const pair = d.pairings[Math.min(choice.pairing, d.pairings.length - 1)];
  const logo = kit.logos[0];
  const initial = (name.trim() || 'B').charAt(0);
  const on = ensureContrast(pal.bg, pal.primary, 4.5);
  return (
    <div className="bw-tiles">
      <div className="bw-tile bw-tile-wide" style={{ background: pal.bg }} title="Primary lockup">
        {logo?.svg ? <span dangerouslySetInnerHTML={{ __html: logo.svg }} /> : logo?.dataUrl ? <img src={logo.dataUrl} alt="" /> : null}
      </div>
      <div className="bw-tile bw-tile-icon" style={{ background: pal.primary, color: on, fontFamily: `'${pair.display}', sans-serif`, fontWeight: pair.displayWeight }} title="App icon">{initial}</div>
    </div>
  );
}

function DirectionCard({ d, selected, onSelect, onContinue, name }: { d: Direction; selected: boolean; onSelect: () => void; onContinue: () => void; name: string }) {
  const choice = DEFAULT_CHOICE(d);
  const spec = useMemo(() => specOfDirection(d, choice, name), [d, name]);  
  const period = Math.min(7200, Math.max(4600, (spec.motion.enter + 3.6) * 1000));
  const [tick, bump] = useReplay(period + d.index * 700);
  const m = motionFor(d.energy);
  const c = d.palettes[0].colors;
  return (
    <article
      className={`bw-dir${selected ? ' is-selected' : ''}`}
      style={{ '--i': d.index, '--dp': c.primary } as CSSProperties}
      role="radio"
      aria-checked={selected}
      aria-label={`${d.title}, based on ${d.archetypeName}`}
      tabIndex={0}
      onClick={onSelect}
      onMouseEnter={bump}
      onKeyDown={(e) => {
        if (e.key === ' ') { e.preventDefault(); onSelect(); }
        else if (e.key === 'Enter') { e.preventDefault(); onSelect(); onContinue(); }
      }}
    >
      <div className="bw-dir-stage"><Stage spec={spec} tick={tick} lead={0.5 + d.index * 0.28} /></div>
      <div className="bw-dir-info">
        <div className="bw-dir-top"><span className="bw-dir-num">0{d.index + 1}</span><h3>{d.title}</h3>{selected && <span className="bw-dir-check"><Check size={14} />Chosen</span>}</div>
        <p className="bw-dir-based">Based on <b>{d.archetypeName}</b> · {m.label.toLowerCase()}</p>
        <p className="bw-dir-why">{d.rationale}</p>
        <div className="bw-dir-rows">
          <div className="bw-dir-row"><span>Palette</span><div className="bw-swatches lg">{swatchKeys.map((k) => <i key={k} style={{ background: c[k] }} title={`${k} ${c[k]}`} />)}</div></div>
          <div className="bw-dir-row"><span>Type</span><div className="bw-typeline"><b style={{ fontFamily: `'${spec.display.family}', sans-serif`, fontWeight: spec.display.weight }}>Aa</b><small>{d.pairings[0].display} · {d.pairings[0].body}</small></div></div>
          <div className="bw-dir-row"><span>Logo</span><LogoTiles kit={d.kit} d={d} choice={choice} name={name} /></div>
        </div>
      </div>
    </article>
  );
}

export function DirectionsStep({ directions, selected, setSelected, onContinue, phase, notes, name }: {
  directions: Direction[]; selected: number; setSelected: (i: number) => void; onContinue: () => void; phase: 'reading' | 'ready'; notes: string[]; name: string;
}) {
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => { if (phase === 'ready') first.current?.focus({ preventScroll: true }); }, [phase]);
  if (phase === 'reading') {
    return (
      <div className="bw-reading" role="status">
        <Sparkles size={26} className="bw-reading-spark" />
        <h2 className="bw-h2">Reading your brief…</h2>
        <div className="bw-read bw-read-big">{notes.slice(0, 6).map((n, i) => <b key={n} style={{ '--i': i } as CSSProperties}>{n}</b>)}</div>
        <p className="bw-faint">Drawing three directions that feel genuinely different.</p>
      </div>
    );
  }
  return (
    <div className="bw-dirs" ref={first} tabIndex={-1}>
      <header className="bw-dirs-head">
        <p className="bw-kicker">Three directions{name.trim() ? ` for ${name.trim()}` : ''}</p>
        <h2 className="bw-h2">Pick the one that feels like you.</h2>
        <p className="bw-faint">Hover a card to replay it. You will refine the colours, type and motion next.</p>
      </header>
      <div className="bw-dir-list" role="radiogroup" aria-label="Brand directions">
        {directions.map((d, i) => <DirectionCard key={d.id} d={d} name={name} selected={selected === i} onSelect={() => setSelected(i)} onContinue={onContinue} />)}
      </div>
    </div>
  );
}

// ── refine ───────────────────────────────────────────────────────────────────

export function RefineStep({ d, choice, setChoice, name, setName, onCreate }: {
  d: Direction; choice: RefineChoice; setChoice: (c: RefineChoice) => void; name: string; setName: (n: string) => void; onCreate: (kit: BrandKit) => void;
}) {
  const brandName = name.trim() || 'My brand';
  const built = useMemo(() => buildDirectionKit({ ...d, brief: { ...d.brief, name: brandName } }, choice), [d, choice, brandName]);
  const spec = useMemo(() => specOfDirection(d, choice, brandName), [d, choice, brandName]);
  const [tick, bump] = useReplay(6200);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    const id = window.setTimeout(bump, prefersReducedMotion() ? 0 : 220);
    return () => window.clearTimeout(id);
  }, [choice.palette, choice.pairing, choice.energy, brandName]);  
  const motion = motionFor(choice.energy);
  return (
    <div className="bw-refine">
      <div className="bw-refine-preview">
        <p className="bw-kicker">{d.title}</p>
        <Stage spec={spec} tick={tick} size="lg" className="bw-stage-hero" />
        <LogoTiles kit={built.kit} d={d} choice={choice} name={brandName} />
      </div>
      <div className="bw-refine-panel">
        <h2 className="bw-h2">Make it yours.</h2>
        <label className="bw-field"><span>Brand name</span><input value={name} placeholder="My brand" maxLength={48} onChange={(e) => setName(e.target.value)} /></label>

        <fieldset className="bw-opts"><legend>Palette</legend>
          <div className="bw-opt-row" role="radiogroup" aria-label="Palette">
            {d.palettes.map((p, i) => (
              <button key={p.id} type="button" role="radio" aria-checked={choice.palette === i} className={`bw-opt${choice.palette === i ? ' is-on' : ''}`} onClick={() => setChoice({ ...choice, palette: i })}>
                <span className="bw-opt-sw">{(['bg', 'primary', 'accent', 'accent2', 'text'] as const).map((k) => <i key={k} style={{ background: p.colors[k] }} />)}</span>
                <b>{p.label}</b>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="bw-opts"><legend>Type pairing</legend>
          <div className="bw-opt-row" role="radiogroup" aria-label="Type pairing">
            {d.pairings.map((p, i) => (
              <button key={p.id} type="button" role="radio" aria-checked={choice.pairing === i} className={`bw-opt${choice.pairing === i ? ' is-on' : ''}`} onClick={() => setChoice({ ...choice, pairing: i })}>
                <span className="bw-opt-aa" style={{ fontFamily: `'${p.display}', sans-serif`, fontWeight: p.displayWeight, textTransform: p.transform === 'uppercase' ? 'uppercase' : 'none', letterSpacing: p.tracking }}>Aa</span>
                <b>{p.display}</b><small style={{ fontFamily: `'${p.body}', sans-serif` }}>with {p.body}</small>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="bw-opts"><legend>Motion energy <em>{motion.label}</em></legend>
          <div className="bw-energy">
            <span>Calm</span>
            <input type="range" min={0} max={100} value={Math.round(choice.energy * 100)} aria-label="Motion energy" style={{ '--pct': `${Math.round(choice.energy * 100)}%` } as CSSProperties} onChange={(e) => setChoice({ ...choice, energy: Number(e.target.value) / 100 })} />
            <span>Springy</span>
          </div>
        </fieldset>

        <button type="button" className="bw-go bw-create" onClick={() => onCreate(built.kit)}><Sparkles size={16} />Create brand<ArrowRight size={16} /></button>
      </div>
    </div>
  );
}
