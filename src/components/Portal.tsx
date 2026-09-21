// Menus that must not be cut off by the panel they belong to.
//
// Every panel frame is `overflow: clip`, which clips its whole subtree — a fixed-position child
// included. A drop-up anchored inside the chat column was therefore sliced at the column's edge
// and painted under its neighbour. Rendering it into the document instead takes it out of that
// clip entirely, and one shared placement helper keeps it attached to the button that opened it.
import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

export type Placement = { position: 'fixed'; bottom: number; left?: number; right?: number; maxHeight: number };

/**
 * Keeps a drop-up attached to its trigger, in viewport coordinates.
 *
 * It opens upward because these live at the bottom of the window, flips to hang off the trigger's
 * right edge when there is no room to its left, and is measured again on a resize so a menu left
 * open while the window changes does not drift off its button.
 */
export function usePlacement(trigger: RefObject<HTMLElement | null>, open: boolean, width: number): Placement | undefined {
  const [placement, setPlacement] = useState<Placement>();

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const node = trigger.current;
      if (!node) return;
      const box = node.getBoundingClientRect();
      const gap = 7;
      const margin = 8;
      const next: Placement = {
        position: 'fixed',
        bottom: Math.round(window.innerHeight - box.top + gap),
        maxHeight: Math.max(160, Math.round(box.top - gap - margin)),
      };
      if (box.left + width <= window.innerWidth - margin) next.left = Math.round(box.left);
      else next.right = Math.round(Math.max(margin, window.innerWidth - box.right));
      setPlacement(next);
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [trigger, open, width]);

  return placement;
}
