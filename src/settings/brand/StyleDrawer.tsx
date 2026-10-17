// "Start from a style": the archetypes, reference kits and DaisyUI colour themes, in a drawer that
// slides over the canvas. One click starts (or opens) a kit in a style, or recolours the open kit.

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ARCHETYPES, DAISY_THEMES, colorsFrom, findArchetype, type BrandArchetype, type BrandKit, type DaisyTheme } from '../../lib/brandKit';
import { archetypeLabel, cardMotion } from './helpers';
import { Segmented } from './shared';

function ArchetypeCard({ arch, selected, made, onPick }: { arch: BrandArchetype; selected: boolean; made?: boolean; onPick: () => void }) {
  const c = arch.colors;
  const display = arch.typography.display;
  return (
    <button type="button" className={`bk-card ${selected ? 'active' : ''}`} onClick={onPick} title={`${arch.name} — ${arch.character}${made ? ' · you have a kit in this style' : ''}`} aria-pressed={selected} style={{ ...cardMotion(arch.motion), background: c.bg, color: c.text }}>
      <span className="bk-card-field" style={{ background: `linear-gradient(${arch.gradient.angle}deg, ${arch.gradient.stops.join(', ')})` }} />
      <span className="bk-card-body">
        <span className="bk-card-title" style={{ fontFamily: `"${display.family}", system-ui, sans-serif`, fontWeight: display.weight, letterSpacing: display.letterSpacing, textTransform: display.transform }}>{archetypeLabel(arch.name)}</span>
        <span className="bk-card-sub" style={{ color: c.muted }}>{arch.industries[0] ?? arch.group}</span>
      </span>
      <span className="bk-card-swatches">{[c.primary, c.accent, c.accent2, c.surface, c.text].map((hex, i) => <i key={i} style={{ background: hex, transitionDelay: `calc(var(--bk-stagger) * ${i})` }} />)}</span>
      {selected && <span className="bk-card-check" style={{ background: c.primary, color: c.bg }}>✓</span>}
      {made && !selected && <span className="bk-card-made" title="You have a kit in this style">●</span>}
    </button>
  );
}

function DaisyCard({ theme, selected, onPick }: { theme: DaisyTheme; selected: boolean; onPick: () => void }) {
  const c = theme.colors;
  return (
    <button type="button" className={`bk-card bk-card-daisy ${selected ? 'active' : ''}`} onClick={onPick} title={`DaisyUI · ${theme.name} — ${theme.character}`} aria-pressed={selected} style={{ background: c.base100, color: c.baseContent, ['--bk-radius' as string]: theme.radius.box }}>
      <span className="bk-card-chips">
        <i style={{ background: c.primary, color: c.primaryContent }}>A</i><i style={{ background: c.secondary, color: c.secondaryContent, transitionDelay: '.05s' }}>A</i>
        <i style={{ background: c.accent, color: c.accentContent, transitionDelay: '.1s' }}>A</i><i style={{ background: c.neutral, color: c.neutralContent, transitionDelay: '.15s' }}>A</i>
      </span>
      <span className="bk-card-body"><span className="bk-card-title">{theme.name}</span><span className="bk-card-sub" style={{ color: c.baseContent, opacity: 0.65 }}>{theme.scheme}</span></span>
      <span className="bk-card-bars"><i style={{ background: c.base200 }} /><i style={{ background: c.base300 }} /><i style={{ background: c.info }} /><i style={{ background: c.success }} /><i style={{ background: c.warning }} /><i style={{ background: c.error }} /></span>
      {selected && <span className="bk-card-check" style={{ background: c.primary, color: c.primaryContent }}>✓</span>}
    </button>
  );
}

const GROUPS: { group: BrandArchetype['group']; label: string; hint: string }[] = [
  { group: 'house', label: 'House', hint: 'The Bhippi look' },
  { group: 'archetype', label: 'Style archetypes', hint: 'Hover a card to see its motion' },
  { group: 'reference', label: 'Reference kits', hint: 'Rebuilt from public brand boards' },
];

export function StyleDrawer({ kits, selected, tab: initialTab, onClose, onPickArchetype, onPickColours }: {
  kits: BrandKit[]; selected: BrandKit | null; tab: 'styles' | 'colours'; onClose: () => void; onPickArchetype: (arch: BrandArchetype) => void; onPickColours: (themeId: string | null) => void;
}) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  const arch = (selected && findArchetype(selected.style)) || ARCHETYPES[0];
  const styleHexes = colorsFrom(arch, arch.colors).tokens.map((t) => t.hex.toLowerCase()).sort().join();
  const own = !!selected && !selected.colors.daisyTheme && selected.colors.tokens.map((t) => t.hex.toLowerCase()).sort().join() === styleHexes;
  return (
    <>
      <div className="bs-scrim" onClick={onClose} />
      <aside className="bs-drawer" role="dialog" aria-label="Start from a style">
        <header>
          <div><h4>Start from a style</h4><p>{tab === 'styles' ? 'Click one to start a kit in that style, or open the one you already made.' : selected ? `Click to recolour ${selected.name}.` : 'Pick a kit first, then a colour theme.'}</p></div>
          <button type="button" className="bs-icon-btn" aria-label="Close" onClick={onClose}><X size={15} /></button>
        </header>
        <Segmented label="Library" value={tab} onChange={setTab} options={[{ value: 'styles', label: 'Styles' }, { value: 'colours', label: 'Colour themes' }]} />
        <div className="bs-drawer-body">
          {tab === 'styles' ? GROUPS.map(({ group, label, hint }) => (
            <section key={group}>
              <div className="bs-group-head"><span>{label}</span><small>{hint}</small></div>
              <div className="bk-lib-grid">{ARCHETYPES.filter((a) => a.group === group).map((a) => <ArchetypeCard key={a.id} arch={a} selected={selected?.style === a.id} made={kits.some((k) => k.style === a.id)} onPick={() => onPickArchetype(a)} />)}</div>
            </section>
          )) : (
            <section>
              <div className="bk-lib-grid">
                <button type="button" className={`bk-card bk-card-none ${own ? 'active' : ''}`} onClick={() => onPickColours(null)} aria-pressed={own} title={selected ? `Recolour ${selected.name} with ${archetypeLabel(arch.name)}'s own colours` : 'Pick a kit first'} style={{ ...cardMotion(arch.motion), background: arch.colors.bg, color: arch.colors.text }}>
                  <span className="bk-card-swatches tall">{[arch.colors.primary, arch.colors.accent, arch.colors.accent2, arch.colors.surface].map((hex, i) => <i key={i} style={{ background: hex, transitionDelay: `calc(var(--bk-stagger) * ${i})` }} />)}</span>
                  <span className="bk-card-body"><span className="bk-card-title">Style colours</span><span className="bk-card-sub" style={{ color: arch.colors.muted }}>{archetypeLabel(arch.name)}</span></span>
                  {own && <span className="bk-card-check" style={{ background: arch.colors.primary, color: arch.colors.bg }}>✓</span>}
                </button>
                {DAISY_THEMES.map((t) => <DaisyCard key={t.id} theme={t} selected={selected?.colors.daisyTheme === t.id} onPick={() => onPickColours(t.id)} />)}
              </div>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
