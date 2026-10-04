// Bhippi Video Editor is free and open source software (MIT).
// No Google login or license keys are required.
import { useState, type ReactNode } from 'react';
import { useEffect } from 'react';
import { bootStore } from '../boot/bootStore';
import { licenseStore } from './licenseStore';

export function LicenseGate({ children }: { children: ReactNode }) {
  useEffect(() => {
    bootStore.say('Free & Open Source');
    bootStore.licenseSettled('Ready');
    licenseStore.setBlocked(false);
  }, []);

  return <>{children}</>;
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

export function SignIn({ message: _message, compact: _compact }: { message?: string | null; compact?: boolean }) {
  return (
    <div className="gate-body">
      <h2>Free &amp; Open Source</h2>
      <p className="gate-lead">Bhippi Video Editor is free and open-source under the MIT license. No account or key needed.</p>
    </div>
  );
}

export function Avatar({ picture, name, size }: { picture: string | null; name: string; size: number }) {
  const [broken, setBroken] = useState(false);
  return picture && !broken ? (
    <img className="account-avatar" src={picture} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  ) : (
    <span className="account-avatar account-avatar-letter" style={{ width: size, height: size, fontSize: size * 0.44 }}>
      {(name || 'C').slice(0, 1).toUpperCase()}
    </span>
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
