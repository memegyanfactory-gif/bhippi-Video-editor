// The title bar's profile/edition button.
import { BadgeCheck, ChevronRight, Sparkles, User } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { sidePlacement } from './sidePopover';

export function AccountButton({ onDetails, side = false, showLabel = false }: { onDetails: () => void; side?: boolean; showLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('.modal-backdrop')) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const name = 'Community Edition';

  const face = (
    <span className="account-avatar account-avatar-letter" style={{ width: 24, height: 24, background: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Sparkles size={13} />
    </span>
  );

  return (
    <div className="upd-anchor" ref={anchor}>
      <button
        type="button"
        ref={button}
        className={side ? `prail-action prail-foot-btn prail-account${showLabel ? '' : ' icon-only'}${open ? ' open' : ''}` : `header-avatar${open ? ' open' : ''}`}
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={open ? undefined : name}
        aria-label={`Edition: ${name}`}
      >
        {face}
        {side && showLabel && <span className="prail-foot-label">Edition</span>}
      </button>
      {open && (
        <div className="upd-pop acct-pop" role="dialog" aria-label="Account" id={panelId} style={side ? sidePlacement(button.current) : undefined}>
          <div className="acct-head">
            <span className="acct-face">
              <span className="account-avatar account-avatar-letter" style={{ width: 56, height: 56, background: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' }}>
                <Sparkles size={24} />
              </span>
            </span>
            <div className="acct-who">
              <strong>{name}</strong>
              <span className="acct-email">Free &amp; Open Source (MIT)</span>
              <ul className="acct-tiers">
                <li className="acct-tier kind-paid" title="All features unlocked for everyone">
                  <BadgeCheck size={12} strokeWidth={2.2} /> Unlocked
                </li>
              </ul>
            </div>
          </div>
          <div className="acct-actions">
            <button type="button" className="acct-row" onClick={() => { setOpen(false); onDetails(); }}>
              <User size={15} /> About &amp; License <ChevronRight size={14} className="acct-chev" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
