// The one license status the gate and About › Profile both read.
import { useSyncExternalStore } from 'react';
import { api, type LicenseStatus } from '../lib/ipc';

type Snapshot = {
  status: LicenseStatus | null;
  /** Dev builds started with BHIPPI_DEV_NO_LICENSE=1 only: the person chose to use Bhippi without signing in. */
  devBypass: boolean;
  /** The gate is covering the app: nothing behind it may be used. */
  blocked: boolean;
  /**
   * The last definite answer was "active": a lost connection right after it keeps Bhippi open (the
   * session was licensed; Rust already returns active+offline while a certificate holds). Any blocking
   * answer (signed out, no key, revoked, slots full) clears it, so going offline cannot lift a gate.
   */
  offlineGrace: boolean;
};

const BYPASS_KEY = 'bhippi.license.devBypass';

function storedBypass(): boolean {
  try {
    return localStorage.getItem(BYPASS_KEY) === '1';
  } catch {
    return false;
  }
}

let snapshot: Snapshot = { status: null, devBypass: storedBypass(), blocked: true, offlineGrace: false };
const listeners = new Set<() => void>();

function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

export const licenseStore = {
  get: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setStatus(status: LicenseStatus) {
    // The dev bypass only exists in a debug build started with BHIPPI_DEV_NO_LICENSE=1; never in a release.
    const offlineGrace = status.state === 'active' ? true : status.state === 'unreachable' ? snapshot.offlineGrace : false;
    publish({ status, devBypass: snapshot.devBypass && status.devBypassAllowed, offlineGrace });
  },
  setBlocked(blocked: boolean) {
    if (snapshot.blocked !== blocked) publish({ blocked });
  },
  setDevBypass(on: boolean) {
    try {
      if (on) localStorage.setItem(BYPASS_KEY, '1');
      else localStorage.removeItem(BYPASS_KEY);
    } catch {
      /* storage unavailable: the choice lasts this session */
    }
    publish({ devBypass: on });
  },
  async refresh() {
    const status = await api.licenseStatus();
    licenseStore.setStatus(status);
    return status;
  },
  async signOut() {
    licenseStore.setDevBypass(false);
    licenseStore.setStatus(await api.licenseSignOut());
  },
};

export function useLicense(): Snapshot {
  return useSyncExternalStore(licenseStore.subscribe, licenseStore.get);
}

export const ACCOUNT_URL = 'https://bhippi.com/helios/account';

export const KIND_LABEL: Record<string, string> = { paid: 'Premium',tester: 'Tester', admin: 'Admin' };

export function maskKey(key: string): string {
  return key.replace(/-[A-Z0-9]{5}-[A-Z0-9]{5}-/, '-•••••-•••••-');
}
