// About › Profile: the Google account, its Helios key, and the PCs using the key's slots.
import { Check, Copy, ExternalLink, Eye, EyeOff, KeyRound, LoaderCircle, LogOut, MonitorSmartphone, RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '../components/ui';
import { api, errorText } from '../lib/ipc';
import { ago, Avatar, SignIn } from '../license/LicenseGate';
import { ACCOUNT_URL, KIND_LABEL, licenseStore, maskKey, useLicense } from '../license/licenseStore';

export function ProfileSection() {
  const toast = useToast();
  const { status } = useLicense();
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    // Opening About refreshes the slots and last-seen times.
    void licenseStore.refresh().catch(() => undefined);
  }, []);

  const run = async (id: string, work: () => Promise<void>) => {
    setBusy(id);
    try {
      await work();
    } catch (failure) {
      toast({ tone: 'error', title: 'Account', body: errorText(failure) });
    } finally {
      setBusy(null);
    }
  };

  const account = status?.account;
  const user = account?.user;
  const license = account?.license;
  const devices = account?.devices ?? [];

  if (!status) {
    return <div className="profile-card"><LoaderCircle size={14} className="spin" /> Loading your account…</div>;
  }

  if (status.state === 'signed_out' || (!user && !license)) {
    return (
      <div className="profile-card profile-signed-out">
        <div className="profile-copy">
          <strong>Not signed in</strong>
          <span className="muted">This is a dev build running without a license. Sign in to see how Helios looks to your customers.</span>
        </div>
        <SignIn compact />
      </div>
    );
  }

  return (
    <div className="profile-card">
      <div className="profile-head">
        {user ? <Avatar picture={user.picture} name={user.name ?? user.email} size={44} /> : <span className="account-avatar account-avatar-letter" style={{ width: 44, height: 44 }}><KeyRound size={18} /></span>}
        <div className="profile-copy">
          <strong>{user ? user.name ?? user.email : 'Activated with a key'}</strong>
          <span className="muted">{user ? user.email : 'Not signed in with Google on this PC'}</span>
        </div>
        {license && <span className={`profile-pill kind-${license.revoked ? 'revoked' : license.kind}`}>{license.revoked ? 'Revoked' : KIND_LABEL[license.kind]}</span>}
        {status.devBuild && <span className="profile-pill kind-dev">Dev build</span>}
      </div>

      {status.offline && (
        <p className="profile-note"><WifiOff size={12} /> Offline. Your license is verified until {status.expiresAt ? new Date(status.expiresAt * 1000).toLocaleDateString() : 'soon'}.</p>
      )}

      {license ? (
        <>
          <div className="profile-row">
            <span className="profile-label">Key</span>
            <code className="profile-key">{reveal ? license.key : maskKey(license.key)}</code>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setReveal(!reveal)} title={reveal ? 'Hide' : 'Show'}>{reveal ? <EyeOff size={12} /> : <Eye size={12} />}</button>
            <button
              type="button"
              className="btn btn-small btn-ghost"
              title="Copy"
              onClick={() => {
                void navigator.clipboard.writeText(license.key);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
          <div className="profile-row">
            <span className="profile-label">PC slots</span>
            <span className="profile-slots" aria-label={`${devices.length} of ${license.maxDevices} used`}>
              {Array.from({ length: license.maxDevices }, (_, index) => <span key={index} className={index < devices.length ? 'used' : ''} />)}
            </span>
            <span className="muted">{devices.length} of {license.maxDevices} used</span>
          </div>
          <ul className="profile-devices">
            {devices.map((device) => (
              <li key={device.id}>
                <MonitorSmartphone size={14} />
                <span className="profile-copy">
                  <span>{device.name ?? 'PC'} {device.current && <span className="profile-this">This PC</span>}</span>
                  <span className="muted">{[device.os, device.version && `v${device.version}`, device.current ? null : `last used ${ago(device.lastSeen)}`].filter(Boolean).join(' · ')}</span>
                </span>
                {!device.current && (
                  <button
                    type="button"
                    className="btn btn-small btn-ghost"
                    disabled={busy !== null}
                    onClick={() => void run(device.id, async () => licenseStore.setStatus(await api.licenseReleaseDevice(device.id)))}
                  >
                    {busy === device.id ? <LoaderCircle size={12} className="spin" /> : null} Free slot
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">This account has no Helios key.</p>
      )}

      <div className="profile-actions">
        <button type="button" className="btn btn-small" onClick={() => void api.openUrl(user?.isAdmin ? 'https://bhippi.com/helios/admin' : ACCOUNT_URL)}>
          <ExternalLink size={12} /> {user?.isAdmin ? 'Admin panel' : 'Manage at bhippi.com'}
        </button>
        <button type="button" className="btn btn-small btn-ghost" disabled={busy !== null} onClick={() => void run('refresh', async () => void (await licenseStore.refresh()))}>
          {busy === 'refresh' ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />} Refresh
        </button>
        <button
          type="button"
          className="btn btn-small btn-ghost"
          disabled={busy !== null}
          onClick={() => {
            if (window.confirm('Sign out of Helios on this PC? You’ll need to sign in with Google again to keep using it. This PC keeps its slot until you free it.')) {
              void run('signout', () => licenseStore.signOut());
            }
          }}
        >
          <LogOut size={12} /> Sign out
        </button>
      </div>
    </div>
  );
}
