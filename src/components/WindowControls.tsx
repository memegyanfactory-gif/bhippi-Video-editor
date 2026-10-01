// The window's minimize, maximize and close, as a page of their own (tabs.rs lays it over the top
// right corner of Bhippi's window, index.html?view=controls). Every project's menu bar draws these
// buttons too, but a button in a project's page answers only when that page is free: while it
// loaded a big project, or an AI turn was applying edits, the window could not even be closed. This
// page has nothing else to do and a renderer process of its own, so it always answers.
//
// It is see-through: the project's own buttons, drawn in its theme, show through it. It draws only
// the hover and the press, over them, and takes the clicks. Rust does the rest (`window_control`),
// and hands the keyboard back to the project on screen (clicking here took it).
import { Minus, Square, X } from 'lucide-react';
import { api } from '../lib/ipc';

type Action = 'minimize' | 'maximize' | 'close';

const BUTTONS: { action: Action; label: string; icon: React.ReactNode }[] = [
  // The same icons, at the same sizes, as the menu bar's (AppChrome.tsx), so the hover lands on them.
  { action: 'minimize', label: 'Minimize', icon: <Minus size={14} /> },
  { action: 'maximize', label: 'Maximize', icon: <Square size={11} /> },
  { action: 'close', label: 'Close', icon: <X size={15} /> },
];

export function WindowControls() {
  return (
    <div className="window-controls">
      {BUTTONS.map(({ action, label, icon }) => (
        <button
          key={action}
          type="button"
          tabIndex={-1}
          className={action === 'close' ? 'close' : undefined}
          aria-label={label}
          // No focus ring and no text selection from a press: these are window buttons.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void api.windowControl(action).catch((error) => console.error('The window control failed', error))}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
