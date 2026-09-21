// Global mouse position tracker to ensure HUD modals like FX Console appear
// precisely where the cursor is currently located on screen.

let liveMouse = {
  x: typeof window !== 'undefined' ? Math.round(window.innerWidth / 2) : 400,
  y: typeof window !== 'undefined' ? Math.round(window.innerHeight / 2) : 300,
};

if (typeof window !== 'undefined') {
  const onMove = (e: MouseEvent | PointerEvent) => {
    if (e.clientX !== undefined && e.clientY !== undefined && (e.clientX > 0 || e.clientY > 0)) {
      liveMouse = { x: e.clientX, y: e.clientY };
    }
  };

  window.addEventListener('pointermove', onMove, { capture: true, passive: true });
  window.addEventListener('mousemove', onMove, { capture: true, passive: true });
  window.addEventListener('pointerdown', onMove, { capture: true, passive: true });
  document.addEventListener('pointermove', onMove, { capture: true, passive: true });
  document.addEventListener('mousemove', onMove, { capture: true, passive: true });
}

export function getLiveMousePos(): { x: number; y: number } {
  return { ...liveMouse };
}
