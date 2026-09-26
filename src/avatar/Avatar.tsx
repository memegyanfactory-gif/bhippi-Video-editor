import { useEffect, useRef } from 'react';
import { avatarBus } from './bus';
import { AvatarEngine } from './engine';
import { CHARACTERS, type Character } from './sprite';
import '../styles/avatar.css';

/**
 * Heli (or whichever character Settings › Avatar picked), the pixel avatar that acts out what
 * Bhippi AI is doing. Settings › Avatar switches it on or off; while it is off nothing listens on
 * the bus and nothing runs. Right-clicking the character asks the host for its menu (`onMenu`).
 */
export function Avatar({ enabled, character, onMenu }: { enabled: boolean; character?: string | null; onMenu?: (point: { x: number; y: number }, name: string) => void }) {
  const layer = useRef<HTMLDivElement>(null);
  const engine = useRef<AvatarEngine | null>(null);
  const who: Character = CHARACTERS.some((entry) => entry.id === character) ? (character as Character) : 'heli';
  const menu = useRef(onMenu);
  menu.current = onMenu;
  const name = useRef('');
  name.current = CHARACTERS.find((entry) => entry.id === who)?.name ?? 'Heli';
  useEffect(() => {
    if (!enabled || !layer.current) return;
    const created = new AvatarEngine(layer.current, who, (point) => menu.current?.(point, name.current));
    engine.current = created;
    const unsubscribe = avatarBus.subscribe((event) => created.handle(event));
    return () => {
      unsubscribe();
      created.destroy();
      engine.current = null;
    };
    // The character is swapped in place below, without restarting the engine.
  }, [enabled]);
  useEffect(() => engine.current?.setCharacter(who), [who]);
  return enabled ? <div ref={layer} className="avatar-layer" aria-hidden="true" /> : null;
}
