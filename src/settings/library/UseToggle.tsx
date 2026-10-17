// The one control that tells Bhippi "use this downloaded model": "Use for video" when it is not in
// use, "In use for video" with "Stop using" when it is. Models the AI calls directly (depth, tracking,
// erase) have nothing to switch, so they say they are ready. Shown on every downloaded model: cards,
// rows and the detail panel.
import { Check } from 'lucide-react';
import { useState } from 'react';
import { libraryApi, type CapabilityChoice, type LibraryView } from '../../lib/modelLibrary';
import { useLabel, useStateOf } from '../../lib/modelUse';
import type { Run } from './shared';

type Props = {
  view: LibraryView;
  choices: CapabilityChoice[];
  run: Run;
  onChanged: () => void;
  /** Hide the "Stop using" text button (the switch itself still turns it off). */
  quiet?: boolean;
  className?: string;
};

export function UseToggle({ view, choices, run, onChanged, quiet = false, className = '' }: Props) {
  const [busy, setBusy] = useState(false);
  const { entry, state } = view;
  if (!state.installedVariant || state.broken) return null;
  const use = useStateOf(entry, choices);
  if (use.mode === 'tool') {
    return <span className={`ml-ready ${className}`} title="The AI calls this model itself when a job needs it."><Check size={12} /> {useLabel(use)}</span>;
  }
  const on = use.mode === 'on';
  const change = (next: boolean) => {
    setBusy(true);
    const work = () => (next ? libraryApi.setDefault(use.capability, entry.id, state.installedVariant) : libraryApi.setDefault(use.capability, null));
    void run(work, next ? 'Could not use that model' : 'Could not change that').then((ok) => { setBusy(false); if (ok) onChanged(); });
  };
  return (
    <span className={`ml-use-toggle ${className}`}>
      <button type="button" role="switch" aria-checked={on} className={`ml-switch${on ? ' on' : ''}`} disabled={busy} onClick={() => change(!on)}>
        <i aria-hidden="true" />
        <span>{useLabel(use)}{on ? ' ✓' : ''}</span>
      </button>
      {on && !quiet && <button type="button" className="ml-link-btn ml-stop" disabled={busy} onClick={() => change(false)}>Stop using</button>}
    </span>
  );
}
