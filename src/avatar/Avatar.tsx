import { useEffect, useRef } from 'react';
import { avatarBus } from './bus';
import { AvatarEngine } from './engine';
import '../styles/avatar.css';

/**
 * Heli, the pixel avatar that acts out what Helios AI is doing. Settings › Avatar switches it on
 * or off; while it is off nothing listens on the bus and nothing runs.
 */
export function Avatar({ enabled }: { enabled: boolean }) {
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled || !layer.current) return;
    const engine = new AvatarEngine(layer.current);
    const unsubscribe = avatarBus.subscribe((event) => engine.handle(event));
    return () => {
      unsubscribe();
      engine.destroy();
    };
  }, [enabled]);
  return enabled ? <div ref={layer} className="avatar-layer" aria-hidden="true" /> : null;
}
