// The settings this window holds, kept in step with the backend's copy.
//
// A save sends only the keys it changes: the settings hold brand kits with their logos (megabytes),
// and the timeline zoom and panel layout save themselves often. Sending only the patch also keeps
// what the backend wrote itself — a provider switched off, a speech program located.
import { actionLogger } from './actionLogger';
import { api } from './ipc';
import { repairSettings } from './settingsRepair';
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
 * `onSaveError` hears a save the backend refused (it names the settings it could not keep); the
 * window then reads the backend's copy back, so what it shows is what is saved.
 */
export function settingsSync(defaults: Settings, ref: { current: Settings }, onChange: (settings: Settings) => void, onSaveError?: (message: string) => void): SettingsSync {
  const apply = (raw: Settings) => {
    // Free-JSON settings (brand kits, layouts, workspaces, shortcuts, export presets) written by an
    // older Bhippi, an AI call or an agent editing the file are fitted to their types here, where
    // every copy of the settings comes in, and the repair is saved back.
    const { settings: stored, repaired, notes } = repairSettings(raw);
    ref.current = { ...defaults, ...stored, export: { ...defaults.export, ...stored.export } };
    onChange(ref.current);
    if (repaired.length) {
      actionLogger.system('Repaired saved settings', notes, 'warn');
      const patch = Object.fromEntries(repaired.map((key) => [key, stored[key] ?? null]));
      api.settingsPatch(patch as Partial<Settings>).catch((error: unknown) => actionLogger.error('The repaired settings were not saved', { error: String(error), keys: repaired }));
    }
  };
  const reload = async () => apply(await api.settingsGet());
  return {
    save: (patch) => {
      // Only keys whose value really changed are sent: a panel that hands over the whole settings
      // object would otherwise send every key back (brand-kit logos included) and write this
      // window's copy over what the backend changed itself (a provider it switched off).
      const changed = Object.entries(patch).filter(([key, value]) => value !== ref.current[key as keyof Settings]);
      if (!changed.length) return;
      ref.current = { ...ref.current, ...Object.fromEntries(changed) };
      onChange(ref.current);
      // A key set to undefined is cleared: JSON would drop it, so it goes as null (the default).
      const sent = Object.fromEntries(changed.map(([key, value]) => [key, value === undefined ? null : value]));
      api.settingsPatch(sent as Partial<Settings>).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        actionLogger.error('Settings were not saved', { message, keys: Object.keys(sent) });
        onSaveError?.(message);
        reload().catch(() => undefined);
      });
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
