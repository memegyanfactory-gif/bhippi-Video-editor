// The frame every studio window shares: a 26 px title strip (icon, name, window controls) over a body.
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function TitleBar({ icon, title, children, onClose, closeLabel }: { icon: ReactNode; title: string; children?: ReactNode; onClose?: () => void; closeLabel?: string }) {
  return (
    <header className="ms-titlebar">
      <span className="ms-titlebar-icon" aria-hidden="true">{icon}</span>
      <h3>{title}</h3>
      <span className="ms-grow" />
      {children}
      {onClose && <button type="button" className="ms-win-btn" aria-label={closeLabel ?? `Close ${title}`} title={closeLabel ?? `Close ${title}`} onClick={onClose}><X size={12} /></button>}
    </header>
  );
}
