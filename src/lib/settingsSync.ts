// The settings this window holds, kept in step with the backend's copy.
//
// A save sends only the keys it changes: the settings hold brand kits with their logos (megabytes),
// and the timeline zoom and panel layout save themselves often. Sending only the patch also keeps
// what the backend wrote itself — a provider switched off, a speech program located.
import { api } from './ipc';
import type { ProviderInfo, Settings } from './types';

export type SettingsSync = {
  /** Merges `patch` in and saves the result. */
  save: (patch: Partial<Settings>) => void;
  /** Takes settings as the backend returned them, over the defaults. */
  apply: (stored: Settings) => void;
  /** Reads the backend's copy back in after it wrote to it. */
  reload: () => Promise<void>;
  /** Switches a provider on or off (the backend records it in the settings) and reads the settings back. */
  setProviderEnabled: (id: string, enabled: boolean) => Promise<ProviderInfo[]>;
};

/**
 * `ref` is the window's current settings, read by every later save; it is updated at once, not on
 * the next render, so two saves in one tick both land. `onChange` gets each new value (React state).
 */
export function settingsSync(defaults: Settings, ref: { current: Settings }, onChange: (settings: Settings) => void): SettingsSync {
  const apply = (stored: Settings) => {
    ref.current = { ...defaults, ...stored, export: { ...defaults.export, ...stored.export } };
    onChange(ref.current);
  };
  const reload = async () => apply(await api.settingsGet());
  return {
    save: (patch) => {
      ref.current = { ...ref.current, ...patch };
      onChange(ref.current);
      // A key set to undefined is cleared: JSON would drop it, so it goes as null (the default).
      const sent = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === undefined ? null : value]));
      api.settingsPatch(sent as Partial<Settings>).catch(() => undefined);
    },
    apply,
    reload,
    setProviderEnabled: async (id, enabled) => {
      const rows = await api.providerSetEnabled(id, enabled);
      await reload();
      return rows;
    },
  };
}
