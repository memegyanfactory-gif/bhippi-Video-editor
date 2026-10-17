// The Brand Studio top bar: kit switcher, New brand, Start from a style, health, Apply to project and
// the kit's menu (duplicate, default, import, export, delete).

import { Check, ChevronDown, Copy, Download, Layers, MoreHorizontal, Plus, Star, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import type { BrandKit } from '../../lib/brandKit';
import type { BrandHealth } from '../../lib/brandKit/health';
import { KitThumb } from './KitThumb';
import { Popover } from './shared';

export type TopBarProps = {
  kits: BrandKit[];
  selected: BrandKit | null;
  projectKitId: string | null;
  defaultKitId: string | null;
  health: BrandHealth | null;
  onSelect: (kit: BrandKit) => void;
  onNew: () => void;
  onStyles: () => void;
  onApply: () => void;
  onDefault: () => void;
  onDuplicate: () => void;
  onImport: () => void;
  onExport: () => void;
  onDelete: () => void;
  onHealth: () => void;
};

export function StudioTopBar(p: TopBarProps) {
  const [switcher, setSwitcher] = useState<HTMLElement | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [confirm, setConfirm] = useState(false);
  const applied = !!p.selected && p.projectKitId === p.selected.id;
  const tone = !p.health ? '' : p.health.score >= 90 ? 'great' : p.health.score >= 75 ? 'good' : p.health.score >= 50 ? 'fair' : 'poor';
  const closeMenu = () => { setMenu(null); setConfirm(false); };
  return (
    <header className="bs-top">
      <button type="button" className="bs-switch" disabled={p.kits.length === 0} onClick={(e) => setSwitcher(switcher ? null : e.currentTarget)} aria-haspopup="listbox" aria-expanded={!!switcher} aria-label="Switch brand kit">
        {p.selected ? <><span className="bs-switch-thumb"><KitThumb kit={p.selected} /></span><span className="bs-switch-name"><b>{p.selected.name}</b><small>{p.selected.style}{p.selected.industry ? ` · ${p.selected.industry}` : ''}</small></span></> : <span className="bs-switch-name"><b>Brand Studio</b><small>No brand yet</small></span>}
        <ChevronDown size={14} />
      </button>
      <button type="button" className="bs-btn primary" onClick={p.onNew}><Plus size={14} /> New brand</button>
      <button type="button" className="bs-btn" onClick={p.onStyles}><Layers size={14} /> Start from a style</button>
      <span className="bs-spacer" />
      {p.health && <button type="button" className={`bs-score ${tone}`} onClick={p.onHealth} title="Brand health: open the checks"><i /> {p.health.score}<small>health</small></button>}
      {p.selected && (
        <button type="button" className={`bs-btn ${applied ? 'applied' : 'accent'}`} onClick={p.onApply} aria-pressed={applied} title={applied ? 'Click to stop using it in this project' : 'Every new graphic, title and generation in this project follows it'}>
          {applied ? <><Check size={14} strokeWidth={3} /> Used by this project</> : 'Apply to project'}
        </button>
      )}
      <button type="button" className="bs-btn icon" disabled={!p.selected && p.kits.length === 0} aria-label="More" aria-haspopup="menu" onClick={(e) => setMenu(menu ? null : e.currentTarget)}><MoreHorizontal size={16} /></button>

      {switcher && (
        <Popover anchor={switcher} onClose={() => setSwitcher(null)} width={340} label="Brand kits">
          <ul className="bs-kitlist" role="listbox" aria-label="Brand kits">
            {p.kits.map((kit) => (
              <li key={kit.id} role="option" aria-selected={kit.id === p.selected?.id}>
                <button type="button" className={kit.id === p.selected?.id ? 'on' : ''} onClick={() => { p.onSelect(kit); setSwitcher(null); }}>
                  <span className="bs-kit-thumb"><KitThumb kit={kit} /></span>
                  <span><b>{kit.name}</b><small>{kit.style}{kit.industry ? ` · ${kit.industry}` : ''}</small></span>
                  <span className="bs-kit-badges">{p.projectKitId === kit.id && <em>this project</em>}{p.defaultKitId === kit.id && <em className="mute">default</em>}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="bs-pop-action" onClick={() => { setSwitcher(null); p.onNew(); }}><Plus size={13} /> New brand</button>
        </Popover>
      )}
      {menu && (
        <Popover anchor={menu} onClose={closeMenu} width={232} label="Brand kit menu">
          <ul className="bs-menu" role="menu">
            {p.selected && <li><button type="button" role="menuitem" onClick={() => { closeMenu(); p.onDuplicate(); }}><Copy size={13} /> Duplicate</button></li>}
            {p.selected && <li><button type="button" role="menuitem" onClick={() => { closeMenu(); p.onDefault(); }}><Star size={13} /> {p.defaultKitId === p.selected.id ? 'Not the default for new projects' : 'Make default for new projects'}</button></li>}
            <li><button type="button" role="menuitem" onClick={() => { closeMenu(); p.onImport(); }}><Upload size={13} /> Import JSON…</button></li>
            {p.selected && <li><button type="button" role="menuitem" onClick={() => { closeMenu(); p.onExport(); }}><Download size={13} /> Export JSON (copy)</button></li>}
            {p.selected && <li className="sep"><button type="button" role="menuitem" className="danger" onClick={() => { if (confirm) { closeMenu(); p.onDelete(); } else setConfirm(true); }}><Trash2 size={13} /> {confirm ? `Delete ${p.selected.name}? Click again` : 'Delete this brand'}</button></li>}
          </ul>
        </Popover>
      )}
    </header>
  );
}
