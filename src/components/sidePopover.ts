// Where a button at the foot of the projects panel opens its popover: to the right of the panel,
// its bottom level with the button's, so it grows upward into the room above. Fixed to the
// window, because the panel clips what overflows it.
import type { CSSProperties } from 'react';

const GAP = 10;
const MARGIN = 8;

export function sidePlacement(button: HTMLElement | null): CSSProperties | undefined {
  if (!button) return undefined;
  const rect = button.getBoundingClientRect();
  const panel = button.closest('.prail')?.getBoundingClientRect();
  return {
    position: 'fixed',
    left: Math.round((panel?.right ?? rect.right) + GAP),
    bottom: Math.max(MARGIN, Math.round(window.innerHeight - rect.bottom)),
    top: 'auto',
    right: 'auto',
    maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
    overflowY: 'auto',
    transformOrigin: 'bottom left',
  };
}
