// The one license status the gate and About › Profile both read.
// Bhippi Video Editor is free and open-source software (MIT).
import { useSyncExternalStore } from 'react';
import { api, events, type LicenseStatus } from '../lib/ipc';

type Snapshot = {
  status: LicenseStatus | null;
  /** Free & open-source / dev bypass: always allowed. */
  devBypass: boolean;
  /** The gate is covering the app: false because Bhippi is completely free and open. */
  blocked: boolean;
  offlineGrace: boolean;
};

const DEFAULT_ACTIVE_STATUS: LicenseStatus = {
  state: 'active',
  offline: false,
  devBuild: false,
  devBypassAllowed: true,
  account: {
    user: { id: 'community', name: 'Community', email: 'free@bhippi.local', picture: null, isAdmin: false },
    license: { key: 'MIT-OPEN-SOURCE', kind: 'paid', maxDevices: 999, revoked: false, since: 0 },
    devices: [],
  },
  expiresAt: null,
  message: null,
  deviceName: 'This PC',
};

let snapshot: Snapshot = {
  status: DEFAULT_ACTIVE_STATUS,
  devBypass: true,
  blocked: false,
  offlineGrace: true,
};

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
    // Keep it active and unblocked for everyone
    const normalized: LicenseStatus = {
      ...status,
      state: 'active',
      devBypassAllowed: true,
    };
    publish({ status: normalized, devBypass: true, blocked: false, offlineGrace: true });
  },
  setBlocked(_blocked: boolean) {
    // Never block in open source mode
    if (snapshot.blocked !== false) publish({ blocked: false });
  },
  setDevBypass(_on: boolean) {
    publish({ devBypass: true });
  },
  async refresh() {
    try {
      const status = await api.licenseStatus();
      licenseStore.setStatus(status);
      return status;
    } catch {
      licenseStore.setStatus(DEFAULT_ACTIVE_STATUS);
      return DEFAULT_ACTIVE_STATUS;
    }
  },
  async signOut() {
    licenseStore.setStatus(DEFAULT_ACTIVE_STATUS);
  },
};

// Each project tab is a webview with its own copy of this store
void events.license((status) => licenseStore.setStatus(status)).catch(() => undefined);

export function useLicense(): Snapshot {
  return useSyncExternalStore(licenseStore.subscribe, licenseStore.get);
}

export const ACCOUNT_URL = 'https://bhippi.com';

export const KIND_LABEL: Record<string, string> = { paid: 'Open Source', tester: 'Tester', admin: 'Admin' };

export function maskKey(key: string): string {
  return key;
}
