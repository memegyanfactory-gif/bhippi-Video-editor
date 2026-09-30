// The settings as the backend hands them over, fitted to the types the app reads. Rust types most
// fields strictly, but keeps some as free JSON (brand kits, the panel layout, saved workspaces,
// shortcuts, export presets). A hand edit, an agent writing the file or an older build could
// leave one of those in a shape that threw on every launch (`hidden.includes`, `binding.split`,
// `workspaces.map`). Each is checked here, where every copy of the settings comes in; what had to
// change is named so the repair can be saved back.

import { repairBrandKitDoc } from './brandKit';
import type { Settings } from './types';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const LAYOUT_NUMBERS = ['chatWidth', 'transcriptWidth', 'topHeight', 'sourceWidth', 'propertiesWidth', 'projectWidth', 'pluginsWidth'] as const;

/** A saved panel layout the app can open, or null when it is not one. Fields that do not fit are dropped (the defaults fill them). */
function repairLayout(value: unknown): { layout: Record<string, unknown> | null; changed: boolean } {
  if (!isRecord(value)) return { layout: null, changed: true };
  let out: Record<string, unknown> | null = null;
  const drop = (key: string) => {
    out ??= { ...value };
    delete out[key];
  };
  if ('hidden' in value) {
    if (!Array.isArray(value.hidden)) drop('hidden');
    else if (value.hidden.some((item) => typeof item !== 'string')) (out ??= { ...value }).hidden = value.hidden.filter((item) => typeof item === 'string');
  }
  if ('docked' in value) {
    if (!Array.isArray(value.docked)) drop('docked');
    else if (value.docked.some((item) => !isRecord(item) || typeof item.id !== 'string')) (out ??= { ...value }).docked = value.docked.filter((item) => isRecord(item) && typeof item.id === 'string');
  }
  if ('meters' in value && value.meters != null && !isRecord(value.meters)) drop('meters');
  for (const key of LAYOUT_NUMBERS) if (key in value && value[key] != null && !(typeof value[key] === 'number' && Number.isFinite(value[key]))) drop(key);
  return { layout: out ?? value, changed: out !== null };
}

/** `stored` with every free-JSON field in a shape the app reads; `repaired` names the fields that changed. */
export function repairSettings(stored: Settings): { settings: Settings; repaired: (keyof Settings)[]; notes: string[] } {
  const repaired: (keyof Settings)[] = [];
  const notes: string[] = [];
  const next: Record<string, unknown> = { ...stored };
  const set = (key: keyof Settings, value: unknown, note: string) => {
    next[key] = value;
    repaired.push(key);
    notes.push(note);
  };

  if (stored.brandKits != null) {
    const kits = repairBrandKitDoc(stored.brandKits);
    if (kits.changed) set('brandKits', kits.doc, kits.issues.length ? `brand kits: ${kits.issues.join('; ')}` : 'brand kits');
  }

  if (stored.layout != null) {
    const { layout, changed } = repairLayout(stored.layout);
    if (changed) set('layout', layout, 'the panel layout');
  }

  if (stored.workspaces != null) {
    const list = Array.isArray(stored.workspaces) ? stored.workspaces : [];
    let changed = !Array.isArray(stored.workspaces);
    const workspaces = list.flatMap((item) => {
      if (!isRecord(item) || typeof item.name !== 'string') {
        changed = true;
        return [];
      }
      const { layout, changed: layoutChanged } = repairLayout(item.layout);
      if (!layout) {
        changed = true;
        return [];
      }
      if (layoutChanged) changed = true;
      return [layoutChanged ? { ...item, layout } : item];
    });
    if (changed) set('workspaces', workspaces, 'saved workspaces');
  }

  if (stored.shortcuts != null) {
    const source: Record<string, unknown> = isRecord(stored.shortcuts) ? stored.shortcuts : {};
    let changed = !isRecord(stored.shortcuts);
    const shortcuts: Record<string, string[]> = {};
    for (const [command, keys] of Object.entries(source)) {
      const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : [];
      const clean = list.filter((key): key is string => typeof key === 'string');
      if (!Array.isArray(keys) || clean.length !== keys.length) changed = true;
      shortcuts[command] = clean;
    }
    if (changed) set('shortcuts', shortcuts, 'keyboard shortcuts');
  }

  const presets = stored.export?.presets;
  if (presets != null) {
    const list = Array.isArray(presets) ? presets : [];
    const clean = list.filter((preset) => isRecord(preset) && typeof preset.id === 'string' && typeof preset.label === 'string' && (preset.settings == null || isRecord(preset.settings)));
    if (!Array.isArray(presets) || clean.length !== presets.length) set('export', { ...stored.export, presets: clean }, 'export presets');
  }

  return { settings: repaired.length ? (next as Settings) : stored, repaired, notes };
}
