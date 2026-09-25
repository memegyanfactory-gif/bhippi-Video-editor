// A failed turn, explained, with the one button that fixes it (adapted from the Bhippi desktop app).
import { AlertTriangle, ChevronDown, Clock, Download, KeyRound, RefreshCw, Repeat, Shrink } from 'lucide-react';
import { useState } from 'react';
import type { TurnFault } from '../lib/types';

const REMEDY_ICONS = { compact: Shrink, update: Download, switch_provider: Repeat, sign_in: KeyRound, retry: RefreshCw, none: RefreshCw };

/** Limits reached are amber, not red: nothing is broken, a boundary was reached. */
function toneOf(kind: string) {
  if (kind === 'cancelled') return 'info';
  // `restricted` belongs here too — a plan the vendor only serves inside its own app is a
  // boundary like any other, not a failure of the thing the user just asked for.
  if (['context_exceeded', 'rate_limited_session', 'rate_limited_weekly', 'quota_exhausted', 'unauthenticated', 'restricted', 'model_unavailable'].includes(kind)) return 'warn';
  return 'error';
}

export function FaultCard({ fault, onAct }: { fault: TurnFault; onAct: (remedy: TurnFault['remedy']) => void }) {
  const [open, setOpen] = useState(false);
  const Icon = REMEDY_ICONS[fault.remedy] ?? RefreshCw;
  return (
    <div className={`fault-card tone-${toneOf(fault.kind)}`} role="alert">
      <div className="fault-head">
        <AlertTriangle size={14} />
        <strong>{fault.title}</strong>
        <span className="fault-provider">{fault.provider}</span>
        {fault.resetsAt && (
          <span className="fault-reset">
            <Clock size={11} /> {fault.resetsAt}
          </span>
        )}
      </div>
      <p className="fault-summary">{fault.summary}</p>
      <p className="fault-fix">{fault.fix}</p>
      <div className="fault-actions">
        {fault.remedy !== 'none' && fault.actionLabel && (
          <button type="button" className="btn btn-small btn-primary" onClick={() => onAct(fault.remedy)}>
            <Icon size={13} /> {fault.actionLabel}
          </button>
        )}
        {fault.detail && (
          <button type="button" className="btn btn-small btn-ghost" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            <ChevronDown size={13} className={open ? 'rotate-180' : ''} /> {open ? 'Hide details' : 'What it said'}
          </button>
        )}
      </div>
      {open && <pre className="fault-detail">{fault.detail}</pre>}
    </div>
  );
}
