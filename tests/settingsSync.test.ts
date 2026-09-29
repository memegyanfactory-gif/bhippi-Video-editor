import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/lib/types';

// The backend's settings file: provider_set_enabled writes to it itself, as the real one does.
const backend = vi.hoisted(() => ({ settings: null as unknown as Settings, saved: [] as Partial<Settings>[] }));
vi.mock('../src/lib/ipc', () => ({
  api: {
    settingsGet: vi.fn(async () => backend.settings),
    settingsPatch: vi.fn(async (patch: Partial<Settings>) => {
      backend.saved.push(patch);
      backend.settings = { ...backend.settings, ...patch };
    }),
    providerSetEnabled: vi.fn(async (id: string, enabled: boolean) => {
      const others = backend.settings.disabledProviders.filter((item) => item !== id);
      backend.settings = { ...backend.settings, disabledProviders: enabled ? others : [...others, id] };
      return [];
    }),
  },
}));

import { settingsSync } from '../src/lib/settingsSync';

const defaults = { disabledProviders: [], timelineZoom: null, export: { resolution: null, fps: null, quality: null, folder: null } } as unknown as Settings;

describe('settings the backend writes itself', () => {
  beforeEach(() => {
    backend.settings = { ...defaults };
    backend.saved = [];
  });

  it('a provider switched off stays off through the next save of something else', async () => {
    const ref = { current: { ...defaults } };
    const store = settingsSync(defaults, ref, () => undefined);
    await store.setProviderEnabled('ollama', false);
    store.save({ timelineZoom: 42 });
    // Only the zoom is sent: the backend's own write stays.
    expect(backend.saved.at(-1)).toEqual({ timelineZoom: 42 });
    expect(backend.settings.disabledProviders).toEqual(['ollama']);
    expect(backend.settings.timelineZoom).toBe(42);
  });

  it('two saves in one tick both land', () => {
    const ref = { current: { ...defaults } };
    const seen: Settings[] = [];
    const store = settingsSync(defaults, ref, (next) => seen.push(next));
    store.save({ timelineZoom: 3 });
    store.save({ disabledProviders: ['groq'] });
    expect(backend.settings).toMatchObject({ timelineZoom: 3, disabledProviders: ['groq'] });
    expect(ref.current).toMatchObject({ timelineZoom: 3, disabledProviders: ['groq'] });
    expect(seen[1]).toBe(ref.current);
  });
});
