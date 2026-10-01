// The title bar's profile button, right of the Settings gear: the signed-in person's picture (or
// initial). Clicking opens a small panel with their name, what kind of Bhippi they're on (Premium,
// Tester, Admin, Dev build) and a sign-out. Settings › About › Profile has the full account.
import { Ban, BadgeCheck, ChevronRight, Code2, FlaskConical, KeyRound, LoaderCircle, LogOut, ShieldCheck, User, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Avatar } from '../license/LicenseGate';
import { KIND_LABEL, licenseStore, useLicense } from '../license/licenseStore';
import { sidePlacement } from './sidePopover';

type Tier = { label: string; kind: string; note: string };

const TIER_ICON: Record<string, LucideIcon> = { paid: BadgeCheck, tester: FlaskConical, admin: ShieldCheck, dev: Code2, revoked: Ban };

function tiers(snapshot: ReturnType<typeof useLicense>): Tier[] {
  const { status, devBypass } = snapshot;
  const license = status?.account?.license;
  const out: Tier[] = [];
  if (license) {
    if (license.revoked) out.push({ label: 'Revoked', kind: 'revoked', note: 'This key was revoked' });
    else if (license.kind === 'paid') out.push({ label: KIND_LABEL.paid, kind: 'paid', note: 'Thanks for buying Bhippi' });
    else if (license.kind === 'tester') out.push({ label: KIND_LABEL.tester, kind: 'tester', note: 'Testing a pre-release key' });
    else if (license.kind === 'admin') out.push({ label: KIND_LABEL.admin, kind: 'admin', note: 'Bhippi team' });
  }
  if (status?.devBuild) out.push({ label: 'Dev build', kind: 'dev', note: devBypass ? 'Running without a license' : 'Developer build of Bhippi' });
  return out;
}

/**
 * The profile button: in the title bar, the picture alone; at the foot of the projects panel
 * (`side`), the picture with the name beside it (`showLabel`), its panel opening to the right.
 */
export function AccountButton({ onDetails, side = false, showLabel = false }: { onDetails: () => void; side?: boolean; showLabel?: boolean }) {
  const snapshot = useLicense();
  const { status } = snapshot;
  const user = status?.account?.user;
  const license = status?.account?.license;
  const signedIn = !!status && status.state !== 'signed_out' && (!!user || !!license);
  const name = user ? user.name ?? user.email : license ? 'Activated with a key' : 'Not signed in';
  const found = tiers(snapshot);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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

  const signOut = async () => {
    if (!window.confirm('Sign out of Bhippi on this PC? You’ll need to sign in with Google again to keep using it. This PC keeps its slot until you free it.')) return;
    setBusy(true);
    try {
      await licenseStore.signOut();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const face = user
    ? <Avatar picture={user.picture} name={name} size={24} />
    : <span className="account-avatar account-avatar-letter" style={{ width: 24, height: 24 }}>{license ? <KeyRound size={12} /> : <User size={13} />}</span>;

  return (
    <div className="upd-anchor" ref={anchor}>
      <button
        type="button"
        ref={button}
        className={side ? `prail-action prail-foot-btn prail-account${showLabel ? '' : ' icon-only'}${open ? ' open' : ''}` : `header-avatar${open ? ' open' : ''}`}
        onClick={() => {
          if (!open) void licenseStore.refresh().catch(() => undefined);
          setOpen(!open);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={open ? undefined : name}
        aria-label={`Profile: ${name}`}
      >
        {face}
        {side && showLabel && <span className="prail-foot-label">{signedIn && user ? user.name ?? user.email : 'Profile'}</span>}
      </button>
      {open && (
        <div className="upd-pop acct-pop" role="dialog" aria-label="Account" id={panelId} style={side ? sidePlacement(button.current) : undefined}>
          <div className="acct-head">
            <span className="acct-face">
              {user ? <Avatar picture={user.picture} name={name} size={56} /> : <span className="account-avatar account-avatar-letter" style={{ width: 56, height: 56 }}>{license ? <KeyRound size={22} /> : <User size={24} />}</span>}
            </span>
            <div className="acct-who">
              <strong title={name}>{name}</strong>
              {user && <span className="acct-email" title={user.email}>{user.email}</span>}
              {found.length > 0 ? (
                <ul className="acct-tiers">
                  {found.map((tier) => {
                    const Icon = TIER_ICON[tier.kind] ?? BadgeCheck;
                    return (
                      <li key={tier.kind} className={`acct-tier kind-${tier.kind}`} title={tier.note}>
                        <Icon size={12} strokeWidth={2.2} /> {tier.label}
                      </li>
                    );
                  })}
                </ul>
              ) : signedIn ? (
                <span className="acct-none">No Bhippi key on this account</span>
              ) : null}
            </div>
          </div>
          <div className="acct-actions">
            <button type="button" className="acct-row" onClick={() => { setOpen(false); onDetails(); }}>
              <User size={15} /> Account details <ChevronRight size={14} className="acct-chev" />
            </button>
            {signedIn && (
              <button type="button" className="acct-row danger" disabled={busy} onClick={() => void signOut()}>
                {busy ? <LoaderCircle size={15} className="spin" /> : <LogOut size={15} />} Log out
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
