// Characters: Bhippi's built-in character studio. It lives in the Plugins area as its own tab and
// opens as a window with a 2D / 3D switch. Both studios are same-origin pages under
// public/characters (their sources are in docs/character-studio); they share one saved-character
// library and hand a finished character to the editor with postMessage, which lands here and
// becomes a transparent PNG in the project's media.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '../lib/ipc';
import type { Asset } from '../lib/types';
import '../styles/characters.css';

export const CHARACTERS_TAB = 'builtin-characters';

type Mode = '2d' | '3d';
const PAGES: Record<Mode, string> = { '2d': 'characters/room2d.html', '3d': 'characters/studio3d.html' };
const LIBRARY_KEY = 'bhippi.characters.v3';

/** The Characters plugin's icon: a bold 2D avatar with kinetic motion lines. */
export function CharactersIcon({ size = 16 }: { size?: number }) {
  return (
    <img
      className="characters-icon"
      src="characters/character-plugin-icon.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

type SavedCharacter = { name: string; skin?: string; age?: string };

function readLibrary(): SavedCharacter[] {
  try {
    const list = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]');
    return Array.isArray(list) ? list.filter((item) => item && typeof item.name === 'string') : [];
  } catch {
    return [];
  }
}

/** What the Characters tab in the Plugins panel shows: what it does, the saved cast, and the way in. */
export function CharactersLauncher({ onOpen, onCustomPlugin, refresh }: { onOpen: (mode: Mode) => void; onCustomPlugin: () => void; refresh: number }) {
  const [saved, setSaved] = useState<SavedCharacter[]>(readLibrary);
  useEffect(() => {
    setSaved(readLibrary());
    const onStorage = (event: StorageEvent) => { if (event.key === LIBRARY_KEY) setSaved(readLibrary()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh]);
  return (
    <div className="characters-launcher">
      {/* The window has its own 2D / 3D switch, so the way in is just the icon and its name. */}
      <button type="button" className="characters-tile" onClick={() => onOpen('2d')} title="Build 2D and 3D characters for this project">
        <CharactersIcon size={36} />
        <span>Characters</span>
      </button>
      {saved.length > 0 && (
        <div className="characters-cast">
          <span className="characters-cast-title">My characters</span>
          <div className="characters-cast-list">
            {saved.slice(0, 24).map((item) => (
              <button key={item.name} type="button" className="characters-cast-item" onClick={() => onOpen('2d')} title={`Open ${item.name}`}>
                <span className="characters-dot" style={{ background: item.skin || '#ccc' }} />
                {item.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <button type="button" className="btn characters-custom" onClick={onCustomPlugin}><Plus size={13} /> Custom plugin</button>
    </div>
  );
}

/**
 * The Characters window. Each studio's frame is created the first time its side is shown and then
 * kept, so switching between 2D and 3D, or closing and reopening the window, keeps the work.
 */
export function CharactersWindow({ open, mode, onMode, onClose, onAdded }: {
  open: boolean;
  mode: Mode;
  onMode: (mode: Mode) => void;
  onClose: () => void;
  /** A character was added to the project's media. */
  onAdded: (asset: Asset, name: string) => void;
}) {
  const [mounted, setMounted] = useState<Record<Mode, boolean>>({ '2d': false, '3d': false });
  const frames = useRef<Record<Mode, HTMLIFrameElement | null>>({ '2d': null, '3d': null });
  const added = useRef(onAdded);
  added.current = onAdded;

  useEffect(() => {
    if (open && !mounted[mode]) setMounted((current) => ({ ...current, [mode]: true }));
  }, [open, mode, mounted]);

  // CSS-hidden iframes do not receive document.visibilitychange. Keep the 2D room's
  // playback position, but release its animation work while another view is open.
  const sync2DVisibility = useCallback(() => {
    frames.current['2d']?.contentWindow?.postMessage(
      { source: 'bhippi-characters-host', type: '2d-visibility', visible: open && mode === '2d' },
      window.location.origin === 'null' ? '*' : window.location.origin,
    );
  }, [open, mode]);
  useEffect(sync2DVisibility, [sync2DVisibility, mounted]);

  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);

  const reply = useCallback((target: MessageEventSource | null, message: Record<string, unknown>) => {
    (target as Window | null)?.postMessage({ source: 'bhippi-characters-host', ...message }, window.location.origin === 'null' ? '*' : window.location.origin);
  }, []);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string; id?: number; name?: string; png?: string } | null;
      if (!data || data.source !== 'bhippi-characters') return;
      const ours = Object.values(frames.current).some((frame) => frame?.contentWindow === event.source);
      if (!ours || data.type !== 'use') return;
      try {
        if (typeof data.png !== 'string' || !data.png.startsWith('data:image/png;base64,')) throw new Error('The studio did not send a picture.');
        const binary = atob(data.png.slice(data.png.indexOf(',') + 1));
        const bytes = new Array<number>(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const name = (data.name || 'Character').slice(0, 60);
        const asset = await api.saveCharacterImage(bytes, name);
        added.current(asset, name);
        reply(event.source, { id: data.id, ok: true, assetId: asset.id });
      } catch (error) {
        reply(event.source, { id: data.id, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [reply]);

  if (!mounted['2d'] && !mounted['3d']) return null;
  return (
    <div className="characters-overlay" style={open ? undefined : { display: 'none' }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="characters-window" role="dialog" aria-modal="true" aria-label="Characters">
        <header className="characters-header">
          <CharactersIcon size={22} />
          <h2>Characters</h2>
          <div className="characters-switch" role="tablist" aria-label="2D or 3D">
            {(['2d', '3d'] as const).map((item) => (
              <button key={item} type="button" role="tab" aria-selected={mode === item} className={mode === item ? 'on' : ''} onClick={() => onMode(item)}>
                {item === '2d' ? '2D' : '3D'}
              </button>
            ))}
          </div>
          <span className="characters-note">{mode === '2d' ? 'Hand-drawn characters that turn a full 360°' : 'Sculpted, rigged 3D characters'} · saved characters work in both</span>
          <button type="button" className="characters-close" onClick={onClose} aria-label="Close Characters" title="Close (Esc)"><X size={16} /></button>
        </header>
        <div className="characters-body">
          {(['2d', '3d'] as const).map((item) => mounted[item] && (
            <iframe
              key={item}
              ref={(node) => { frames.current[item] = node; }}
              className="characters-frame"
              title={item === '2d' ? 'Characters 2D' : 'Characters 3D'}
              src={`/${PAGES[item]}`}
              onLoad={item === '2d' ? sync2DVisibility : undefined}
              style={mode === item ? undefined : { display: 'none' }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
