// Nothing opens until this copy of Bhippi is signed in with Google and holds a key.
//
// First launch: "Sign in with Google" opens bhippi.com in the browser with a short code; the app
// polls until the browser approves it. Then the account's key activates this PC (one of two
// slots) — or, without a key, the person can enter one. After Bhippi has opened once, the gate
// only comes back as an overlay (signing out from About › Profile), so an open project stays put.
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, ExternalLink, KeyRound, LoaderCircle, Minus, MonitorSmartphone, RefreshCw, ShieldAlert, Square, WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, errorText, type AccountDevice, type LicenseStatus } from '../lib/ipc';
import { bootStore } from '../boot/bootStore';
import { ACCOUNT_URL, KIND_LABEL, licenseStore, useLicense } from './licenseStore';

export function LicenseGate({ children }: { children: ReactNode }) {
  const { status, devBypass, offlineGrace } = useLicense();
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bootStore.say('Verifying license');
    licenseStore.refresh()
      .then((status) => bootStore.licenseSettled(licenseLine(status, licenseStore.get().devBypass)))
      .catch((failure) => {
        setError(errorText(failure));
        bootStore.licenseSettled('Could not reach bhippi.com');
      });
  }, []);

  const unlocked = status?.state === 'active' || (devBypass && status?.devBypassAllowed === true);
  useEffect(() => {
    if (unlocked) setOpened(true);
  }, [unlocked]);

  // Without a valid license nothing behind the gate is usable: signed out, no key, key revoked or
  // PC slots full all cover the app. The one exception is a connection lost straight after an
  // "active" answer (offlineGrace) — never after a blocking answer, so going offline lifts nothing.
  const blocked = !unlocked && !(opened && offlineGrace && status?.state === 'unreachable');
  useEffect(() => licenseStore.setBlocked(blocked), [blocked]);

  // The overlay stops the pointer; this stops the keyboard (shortcuts are window listeners). Keys
  // aimed at the gate's own controls keep their default action (typing, Enter, Space on a button)
  // but never travel on to the app's listeners. Only the top-layer close dialog passes through.
  useEffect(() => {
    if (!blocked || !opened) return;
    const stop = (event: Event) => {
      if (document.querySelector('.modal-top')) return;
      const target = event.target as Element | null;
      event.stopImmediatePropagation();
      if (!target?.closest?.('.gate')) event.preventDefault();
    };
    const kinds = ['keydown', 'keyup', 'keypress', 'wheel', 'contextmenu'] as const;
    for (const kind of kinds) window.addEventListener(kind, stop, { capture: true, passive: false });
    return () => { for (const kind of kinds) window.removeEventListener(kind, stop, { capture: true }); };
  }, [blocked, opened]);
  return (
    <>
      {(unlocked || opened) && children}
      {blocked && <GateScreen status={status} error={error} overlay={opened} />}
    </>
  );
}

/** What the launch splash says once the license has answered. */
function licenseLine(status: LicenseStatus, devBypass: boolean): string {
  if (status.state === 'active') return status.account?.license ? `License verified · ${KIND_LABEL[status.account.license.kind] ?? 'Active'}` : 'License verified';
  if (devBypass && status.devBypassAllowed) return 'Developer build · license skipped';
  switch (status.state) {
    case 'signed_out': return 'Sign-in required';
    case 'no_license': return 'No license key on this account';
    case 'slots_full': return 'License already in use on two PCs';
    case 'revoked': return 'License key turned off';
    default: return 'Could not reach bhippi.com';
  }
}

function GateScreen({ status, error, overlay }: { status: LicenseStatus | null; error: string | null; overlay: boolean }) {
  return (
    <div className={`gate${overlay ? ' gate-overlay' : ''}`}>
      <TitleBar />
      <div className="gate-card">
        <img className="gate-logo" src="/bhippi.png" alt="" width={56} height={56} />
        {!status ? (
          error ? <Unreachable message={error} /> : <div className="gate-checking"><LoaderCircle size={18} className="spin" /> Checking your license…</div>
        ) : status.state === 'signed_out' ? (
          <SignIn message={status.message} />
        ) : status.state === 'no_license' ? (
          <NoKey status={status} />
        ) : status.state === 'slots_full' ? (
          <SlotsFull status={status} />
        ) : status.state === 'revoked' ? (
          <Revoked status={status} />
        ) : (
          <Unreachable message={status.message} />
        )}
        {status?.devBypassAllowed && (
          <button type="button" className="gate-dev" onClick={() => licenseStore.setDevBypass(true)}>
            Dev build (BHIPPI_DEV_NO_LICENSE) — continue without a license
          </button>
        )}
      </div>
    </div>
  );
}

/** The window has no native frame; the gate still needs a way to move, resize, maximize and close it. */
function TitleBar() {
  const window_ = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let alive = true;
    const sync = () => void window_.isMaximized().then((value) => { if (alive) setMaximized(value); }).catch(() => undefined);
    sync();
    const pending = window_.onResized(sync);
    return () => { alive = false; void pending.then((unlisten) => unlisten()); };
  }, [window_]);
  return (
    <div className="gate-titlebar" data-tauri-drag-region>
      <span data-tauri-drag-region><img src="/bhippi.png" alt="" width={16} height={16} data-tauri-drag-region /> Bhippi Video Editor</span>
      <button type="button" onClick={() => void window_.minimize()} aria-label="Minimize" title="Minimize"><Minus size={14} /></button>
      <button type="button" onClick={() => void window_.toggleMaximize()} aria-label={maximized ? 'Restore down' : 'Maximize'} title={maximized ? 'Restore down' : 'Maximize'}>
        {maximized ? <Copy size={11} style={{ transform: 'scaleX(-1)' }} /> : <Square size={11} />}
      </button>
      <button type="button" className="gate-close" onClick={() => void window_.close()} aria-label="Close" title="Close"><X size={14} /></button>
    </div>
  );
}

export function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function SignIn({ message, compact }: { message?: string | null; compact?: boolean }) {
  const [login, setLogin] = useState<{ code: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const polling = useRef(false);

  useEffect(() => {
    if (!login) return;
    polling.current = true;
    let timer = 0;
    const tick = async () => {
      if (!polling.current) return;
      try {
        const result = await api.licenseLoginPoll();
        if (result.state === 'done' && result.status) {
          polling.current = false;
          licenseStore.setStatus(result.status);
          return;
        }
        if (result.state === 'expired') {
          polling.current = false;
          setLogin(null);
          setError('The sign-in code expired. Start again.');
          return;
        }
      } catch (failure) {
        polling.current = false;
        setLogin(null);
        setError(errorText(failure));
        return;
      }
      timer = window.setTimeout(() => void tick(), 2000);
    };
    timer = window.setTimeout(() => void tick(), 2000);
    return () => {
      polling.current = false;
      window.clearTimeout(timer);
    };
  }, [login]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setLogin(await api.licenseLoginStart());
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    void api.licenseLoginCancel();
    setLogin(null);
  };

  if (login) {
    return (
      <div className="gate-body">
        <h2>Finish in your browser</h2>
        <p className="gate-lead">Sign in with Google on the page that just opened, then confirm this code:</p>
        <div className="gate-code">{login.code}</div>
        <div className="gate-waiting"><LoaderCircle size={14} className="spin" /> Waiting for the browser…</div>
        <div className="gate-actions">
          <button type="button" className="btn" onClick={() => void api.openUrl(login.url)}><ExternalLink size={14} /> Open the page again</button>
          <button type="button" className="btn btn-ghost" onClick={cancel}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="gate-body">
      {!compact && <h2>Welcome to Bhippi Video Editor</h2>}
      {!compact && <p className="gate-lead">{message ?? 'Sign in with the Google account you got Bhippi with. Your key activates this PC automatically.'}</p>}
      <button type="button" className="gate-google" onClick={() => void start()} disabled={busy}>
        {busy ? <LoaderCircle size={16} className="spin" /> : <GoogleMark />} Sign in with Google
      </button>
      {error && <p className="gate-error">{error}</p>}
      {!compact && (
        <>
          <div className="gate-or"><span>or use your key</span></div>
          <KeyForm />
          <p className="gate-hint">
            Your key is on your account page at{' '}
            <button type="button" className="gate-link" onClick={() => void api.openUrl(ACCOUNT_URL)}>bhippi.com/helios</button>.
          </p>
        </>
      )}
    </div>
  );
}

/** Pasting a key: links it to the signed-in account, or (not signed in) activates this PC on the key alone. */
function KeyForm({ autoFocus }: { autoFocus?: boolean }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redeem = async () => {
    setBusy(true);
    setError(null);
    try {
      licenseStore.setStatus(await api.licenseRedeem(key));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <form className="gate-key" onSubmit={(event) => { event.preventDefault(); void redeem(); }}>
        <KeyRound size={15} />
        <input value={key} onChange={(event) => setKey(event.target.value.toUpperCase())} placeholder="BVE-XXXXX-XXXXX-XXXXX-XXXXX" spellCheck={false} autoFocus={autoFocus} aria-label="Bhippi key" />
        <button type="submit" className="btn btn-primary" disabled={busy || !key.trim()}>{busy ? <LoaderCircle size={14} className="spin" /> : null} Activate</button>
      </form>
      {error && <p className="gate-error">{error}</p>}
    </>
  );
}

function Who({ status }: { status: LicenseStatus }) {
  const user = status.account?.user;
  if (!user) {
    return status.account?.license ? (
      <div className="gate-who">
        <KeyRound size={14} />
        <span>Activated with a key</span>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => void licenseStore.signOut()}>Use another key</button>
      </div>
    ) : null;
  }
  return (
    <div className="gate-who">
      <Avatar picture={user.picture} name={user.name ?? user.email} size={28} />
      <span>{user.email}</span>
      <button type="button" className="btn btn-small btn-ghost" onClick={() => void licenseStore.signOut()}>Use another account</button>
    </div>
  );
}

export function Avatar({ picture, name, size }: { picture: string | null; name: string; size: number }) {
  const [broken, setBroken] = useState(false);
  return picture && !broken ? (
    <img className="account-avatar" src={picture} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  ) : (
    <span className="account-avatar account-avatar-letter" style={{ width: size, height: size, fontSize: size * 0.44 }}>{name.slice(0, 1).toUpperCase()}</span>
  );
}

function NoKey({ status }: { status: LicenseStatus }) {
  return (
    <div className="gate-body">
      <Who status={status} />
      <h2>This account has no Bhippi key</h2>
      <p className="gate-lead">If you have a key, enter it to link it to this Google account. A key works with one account and up to two PCs.</p>
      <KeyForm autoFocus />
      <div className="gate-actions">
        <button type="button" className="btn btn-ghost" onClick={() => void api.openUrl('https://bhippi.com/helios')}><ExternalLink size={14} /> Get Bhippi at bhippi.com</button>
        <button type="button" className="btn btn-ghost" onClick={() => void licenseStore.refresh()}><RefreshCw size={14} /> Check again</button>
      </div>
    </div>
  );
}

function SlotsFull({ status }: { status: LicenseStatus }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const devices = status.account?.devices ?? [];
  const free = async (device: AccountDevice) => {
    setBusy(device.id);
    setError(null);
    try {
      licenseStore.setStatus(await api.licenseReleaseDevice(device.id));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="gate-body">
      <Who status={status} />
      <h2>Your key is in use on {devices.length} PCs</h2>
      <p className="gate-lead">A key works on {status.account?.license?.maxDevices ?? 2} PCs at a time. Free one to use Bhippi on <strong>{status.deviceName}</strong>.</p>
      <ul className="gate-devices">
        {devices.map((device) => (
          <li key={device.id}>
            <MonitorSmartphone size={16} />
            <span className="gate-device-text">
              <strong>{device.name ?? 'PC'}</strong>
              <span>{[device.os, `last used ${ago(device.lastSeen)}`].filter(Boolean).join(' · ')}</span>
            </span>
            <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void free(device)}>
              {busy === device.id ? <LoaderCircle size={12} className="spin" /> : null} Free this slot
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="gate-error">{error}</p>}
    </div>
  );
}

function Revoked({ status }: { status: LicenseStatus }) {
  return (
    <div className="gate-body">
      <Who status={status} />
      <h2><ShieldAlert size={18} /> This key has been turned off</h2>
      <p className="gate-lead">Bhippi can’t open with this account right now. If you think this is a mistake, write to support@bhippi.com.</p>
      <div className="gate-actions">
        <button type="button" className="btn btn-ghost" onClick={() => void api.openUrl(ACCOUNT_URL)}><ExternalLink size={14} /> Open my account</button>
        <button type="button" className="btn btn-ghost" onClick={() => void licenseStore.refresh()}><RefreshCw size={14} /> Check again</button>
      </div>
    </div>
  );
}

function Unreachable({ message }: { message: string | null }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="gate-body">
      <h2><WifiOff size={18} /> Cannot connect to bhippi.com</h2>
      <p className="gate-lead">{message ?? 'Bhippi needs to reach bhippi.com to check your license. Check your internet connection and try again.'}</p>
      <div className="gate-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void licenseStore.refresh().catch(() => undefined).finally(() => setBusy(false));
          }}
        >
          {busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Try again
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void licenseStore.signOut()}>Sign out</button>
      </div>
    </div>
  );
}

export function ago(seconds: number | null | undefined): string {
  if (!seconds) return 'never';
  const diff = Date.now() / 1000 - seconds;
  if (diff < 90) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 30 * 86_400) return `${Math.round(diff / 86_400)} days ago`;
  return new Date(seconds * 1000).toLocaleDateString();
}
