// One engine on the Engines page: a small label, a plain sentence on what it is for, and a status
// box with a dot, a headline, a detail line and the few actions that apply (Install, Start, Stop,
// Change). ComfyUI brings its own box (ModelEngine.tsx); everything else uses this one.
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EngineSection({ icon: Icon, title, blurb, children }: { icon: LucideIcon; title: string; blurb: string; children: ReactNode }) {
  return (
    <section className="ml-eng">
      <h4 className="ml-group-title"><Icon size={13} />{title}</h4>
      <p className="ml-eng-blurb">{blurb}</p>
      {children}
    </section>
  );
}

export function EngineRow({ on, headline, detail, actions, children }: { on: boolean; headline: string; detail?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`ml-engine${on ? ' running' : ''}`}>
      <div className="ml-engine-row">
        <span className="ml-engine-dot" aria-hidden="true" />
        <div className="ml-engine-text">
          <strong>{headline}</strong>
          {detail && <span>{detail}</span>}
        </div>
        {actions && <div className="ml-engine-actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
