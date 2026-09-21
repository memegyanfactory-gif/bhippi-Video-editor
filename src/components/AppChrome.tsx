import { getCurrentWindow } from '@tauri-apps/api/window';
import { Home, Maximize, Minimize, Minus, PanelLeft, Settings, Share, Square, Volume2, VolumeX, X } from 'lucide-react';
import { useState } from 'react';
import { MenuList, type MenuItem } from './workspace';

export type MenuGroup = { label: string; items: MenuItem[] };

/** File · Edit · Clip · … across the top, with the window controls on the right. */
export function MenuBar({ menus }: { menus: MenuGroup[] }) {
  const [open, setOpen] = useState<{ index: number; anchor: DOMRect } | null>(null);
  const win = getCurrentWindow();
  return (
    <div className="menubar" data-tauri-drag-region>
      <img src="/helios.svg" alt="" width={16} height={16} className="menubar-logo" data-tauri-drag-region />
      {menus.map((menu, index) => (
        <button
          key={menu.label}
          type="button"
          className={`menubar-item${open?.index === index ? ' open' : ''}`}
          onClick={(event) => setOpen(open?.index === index ? null : { index, anchor: event.currentTarget.getBoundingClientRect() })}
          onPointerEnter={(event) => open && open.index !== index && setOpen({ index, anchor: event.currentTarget.getBoundingClientRect() })}
        >
          {menu.label}
        </button>
      ))}
      <div className="menubar-drag" data-tauri-drag-region />
      <div className="win-controls">
        <button type="button" className="win-btn" onClick={() => void win.minimize()} aria-label="Minimize"><Minus size={14} /></button>
        <button type="button" className="win-btn" onClick={() => void win.toggleMaximize()} aria-label="Maximize"><Square size={11} /></button>
        <button type="button" className="win-btn close" onClick={() => void win.close()} aria-label="Close"><X size={15} /></button>
      </div>
      {open && <MenuList items={menus[open.index].items} anchor={open.anchor} onClose={() => setOpen(null)} />}
    </div>
  );
}

export type Mode = 'home' | 'edit';

type HeaderProps = {
  mode: Mode;
  onHome: () => void;
  onImport: () => void;
  onEdit: () => void;
  onExport: () => void;
  exportDisabled: boolean;
  title: string;
  saved: boolean;
  chatOpen: boolean;
  onToggleChat: () => void;
  muted: boolean;
  onToggleMute: () => void;
  programMaximized: boolean;
  onToggleProgramMax: () => void;
  onSettings: () => void;
  providerBadge: React.ReactNode;
  resourceMonitor?: React.ReactNode;
};

/** Home · Import · Edit · Export, the document title, and quick actions. */
export function HeaderBar(props: HeaderProps) {
  return (
    <div className="headerbar" data-tauri-drag-region>
      <button type="button" className={`header-home${props.mode === 'home' ? ' active' : ''}`} onClick={props.onHome} title="Home"><Home size={18} /></button>
      <nav className="header-modes">
        <button type="button" onClick={props.onImport}>Import</button>
        <button type="button" className={props.mode === 'edit' ? 'active' : ''} onClick={props.onEdit}>Edit</button>
        <button type="button" onClick={props.onExport} disabled={props.exportDisabled}>Export</button>
        {/* The chat's dock toggle, where ChatGPT's sits: a panel outline, filled on the side the
            panel is on, so the icon says which way it will go. */}
        <button
          type="button"
          className={`header-dock${props.chatOpen ? ' active' : ''}`}
          onClick={props.onToggleChat}
          title={`${props.chatOpen ? 'Hide' : 'Show'} Helios AI (Ctrl+L)`}
          aria-pressed={props.chatOpen}
        >
          <PanelLeft size={19} />
        </button>
      </nav>
      <div className="header-title" data-tauri-drag-region>
        {props.title} <span className="muted">- {props.saved ? 'Saved' : 'Edited'}</span>
      </div>
      <div className="header-actions">
        {props.resourceMonitor}
        <button type="button" className="icon-btn" onClick={props.onExport} disabled={props.exportDisabled} title="Quick export (Ctrl+M)"><Share size={16} /></button>
        <button type="button" className="icon-btn" onClick={props.onToggleMute} title={props.muted ? 'Unmute preview' : 'Mute preview'}>{props.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
        <button type="button" className="icon-btn" onClick={props.onToggleProgramMax} title="Maximize Program monitor (`)">{props.programMaximized ? <Minimize size={15} /> : <Maximize size={15} />}</button>
        <button type="button" className="icon-btn" onClick={props.onSettings} title="Settings (Ctrl+,)"><Settings size={16} /></button>
        <button type="button" className="header-avatar" onClick={props.onSettings} title="AI providers">{props.providerBadge}</button>
      </div>
    </div>
  );
}
