// "Start from a style instead": the archetype and reference library as a grid; every card plays its
// reveal on hover or focus. Choosing one builds a kit from it.

import { ArrowLeft } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { ARCHETYPES, kitFromArchetypeChecked, type BrandArchetype, type BrandKit } from '../../../lib/brandKit';
import { archetypeLabel } from '../../../lib/brandKit/directions';
import { Stage, type StageSpec } from './Stage';

const GROUPS: { id: 'all' | BrandArchetype['group']; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'archetype', label: 'Styles' }, { id: 'reference', label: 'References' }, { id: 'house', label: 'House' },
];

export const specOfArchetype = (a: BrandArchetype, name: string): StageSpec => ({
  name,
  colors: a.colors,
  display: { family: a.typography.display.family, weight: a.typography.display.weight, transform: a.typography.display.transform, letterSpacing: a.typography.display.letterSpacing },
  body: a.typography.body.family,
  motion: { easing: a.motion.easing, enter: a.motion.enter, stagger: a.motion.stagger, intensity: a.motion.intensity },
  wordmark: 'dot',
  tagline: a.voice.samples[0],
});

function StyleCard({ a, name, onPick }: { a: BrandArchetype; name: string; onPick: () => void }) {
  const [tick, setTick] = useState(0);
  const label = archetypeLabel(a.name);
  return (
    <button type="button" className="bw-style" onMouseEnter={() => setTick((n) => n + 1)} onFocus={() => setTick((n) => n + 1)} onClick={onPick} aria-label={`Start from ${label}`}>
      <Stage spec={specOfArchetype(a, name || label)} tick={tick} size="md" />
      <span className="bw-style-meta">
        <b>{label}</b>
        <small>{a.character}</small>
        <span className="bw-swatches">{[a.colors.bg, a.colors.primary, a.colors.accent, a.colors.accent2, a.colors.text].map((c) => <i key={c + label} style={{ background: c }} />)}</span>
      </span>
    </button>
  );
}

export function StylesGrid({ name, setName, onBack, onCreate }: { name: string; setName: (n: string) => void; onBack: () => void; onCreate: (kit: BrandKit) => void }) {
  const [group, setGroup] = useState<(typeof GROUPS)[number]['id']>('all');
  const list = ARCHETYPES.filter((a) => group === 'all' || a.group === group);
  const pick = (a: BrandArchetype) => onCreate(kitFromArchetypeChecked(a, { style: a.id, name: name.trim() || (a.group === 'house' ? 'My brand' : archetypeLabel(a.name)) }).kit);
  return (
    <div className="bw-styles">
      <header className="bw-styles-head">
        <button type="button" className="bw-link" onClick={onBack}><ArrowLeft size={14} />Back to describing it</button>
        <p className="bw-kicker">The style library</p>
        <h2 className="bw-h2">Start from a style.</h2>
        <div className="bw-styles-tools">
          <div className="bw-tabs" role="tablist" aria-label="Style groups">
            {GROUPS.map((g) => <button key={g.id} type="button" role="tab" aria-selected={group === g.id} className={group === g.id ? 'is-on' : ''} onClick={() => setGroup(g.id)}>{g.label}</button>)}
          </div>
          <input className="bw-mid" value={name} placeholder="Name it (optional)" aria-label="Brand name" maxLength={48} onChange={(e) => setName(e.target.value)} />
        </div>
      </header>
      <div className="bw-style-grid">
        {list.map((a, i) => <div key={a.id} className="bw-style-wrap" style={{ '--i': Math.min(i, 14) } as CSSProperties}><StyleCard a={a} name={name} onPick={() => pick(a)} /></div>)}
      </div>
    </div>
  );
}
