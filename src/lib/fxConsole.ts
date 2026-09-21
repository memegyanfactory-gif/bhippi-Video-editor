// FX Console workflow engine: settings, instant search, shortcut slots 1-9, overrides,
// snapshot capture, multi-snapshot gallery, color sampling, and settings import/export.

import type { FxConsoleSettings, FxEffectOverride, FxSnapshot } from './types';
import { AVAILABLE_EFFECTS as ALL_EFFECTS, type EffectDefinition } from './effectsCatalog';

const SETTINGS_KEY = 'helios_fx_console_settings';
const SNAPSHOTS_KEY = 'helios_fx_console_snapshots';

export const DEFAULT_FX_SETTINGS: FxConsoleSettings = {
  hotkey: 'Ctrl+Space',
  shortcuts: {
    1: 'gaussian-blur',
    2: 'lumetri-color',
    3: 'curves',
    4: 'glow',
    5: 'hue-saturation',
    6: 'fast-box-blur',
    7: 'invert',
    8: 'black-white',
    9: 'unsharp-mask',
  },
  overrides: {
    'gaussian-blur': { apply: { blur: 14 } },
    'lumetri-color': { apply: { brightness: 5, contrast: 15, saturation: 115 } },
  },
  favorites: ['lumetri-color', 'gaussian-blur', 'curves', 'glow', 'turbulent-displace'],
  recentSearches: [],
  autoReimportAsPng: false,
};

export function loadFxSettings(): FxConsoleSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_FX_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      hotkey: parsed.hotkey || DEFAULT_FX_SETTINGS.hotkey,
      shortcuts: { ...DEFAULT_FX_SETTINGS.shortcuts, ...(parsed.shortcuts || {}) },
      overrides: { ...DEFAULT_FX_SETTINGS.overrides, ...(parsed.overrides || {}) },
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : DEFAULT_FX_SETTINGS.favorites,
      recentSearches: Array.isArray(parsed.recentSearches) ? parsed.recentSearches : [],
      autoReimportAsPng: !!parsed.autoReimportAsPng,
    };
  } catch {
    return { ...DEFAULT_FX_SETTINGS };
  }
}

export function saveFxSettings(settings: FxConsoleSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('Failed to save FX Console settings', err);
  }
}

export function loadFxSnapshots(): FxSnapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveFxSnapshots(snapshots: FxSnapshot[]): void {
  try {
    // Keep max 30 snapshots in local storage to prevent quota overflow
    const trimmed = snapshots.slice(-30);
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.error('Failed to save snapshots', err);
  }
}

/** Export settings as a downloadable JSON file */
export function exportFxSettingsFile(settings: FxConsoleSettings): void {
  const data = JSON.stringify(settings, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `helios-fx-console-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Import settings from a JSON file */
export async function importFxSettingsFile(file: File): Promise<FxConsoleSettings> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const merged: FxConsoleSettings = {
    hotkey: typeof parsed.hotkey === 'string' ? parsed.hotkey : DEFAULT_FX_SETTINGS.hotkey,
    shortcuts: { ...DEFAULT_FX_SETTINGS.shortcuts, ...(parsed.shortcuts || {}) },
    overrides: { ...DEFAULT_FX_SETTINGS.overrides, ...(parsed.overrides || {}) },
    favorites: Array.isArray(parsed.favorites) ? parsed.favorites : DEFAULT_FX_SETTINGS.favorites,
    recentSearches: Array.isArray(parsed.recentSearches) ? parsed.recentSearches : [],
    autoReimportAsPng: !!parsed.autoReimportAsPng,
  };
  saveFxSettings(merged);
  return merged;
}

/** Resolve effective effect definition applying user overrides */
export function resolveEffect(effect: EffectDefinition, overrides: Record<string, FxEffectOverride>): EffectDefinition {
  const override = overrides[effect.id];
  if (!override) return effect;
  return {
    ...effect,
    label: override.label || effect.label,
    apply: override.apply ? { ...effect.apply, ...override.apply } : effect.apply,
  };
}

/** Search effects by query, category, and fuzzy matching */
export function searchEffects(
  query: string,
  category: string,
  overrides: Record<string, FxEffectOverride>,
  favorites: string[]
): EffectDefinition[] {
  const q = query.trim().toLowerCase();
  let pool = ALL_EFFECTS.map((eff) => resolveEffect(eff, overrides));

  if (category && category !== 'All') {
    if (category === 'Favorites') {
      pool = pool.filter((eff) => favorites.includes(eff.id));
    } else {
      pool = pool.filter((eff) => eff.group === category);
    }
  }

  if (!q) {
    // Sort favorites to top when no query
    return pool.sort((a, b) => {
      const aFav = favorites.includes(a.id);
      const bFav = favorites.includes(b.id);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      return a.label.localeCompare(b.label);
    });
  }

  return pool
    .map((eff) => {
      let score = 0;
      const labelLower = eff.label.toLowerCase();
      const groupLower = eff.group.toLowerCase();
      const tags = eff.tags || [];

      if (labelLower === q) score += 100;
      else if (labelLower.startsWith(q)) score += 60;
      else if (labelLower.includes(q)) score += 40;

      if (groupLower.includes(q)) score += 20;

      for (const tag of tags) {
        if (tag.toLowerCase().includes(q)) score += 15;
      }

      if (favorites.includes(eff.id)) score += 10;

      return { eff, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.eff.label.localeCompare(b.eff.label))
    .map((item) => item.eff);
}

/** Captures an instant high-resolution snapshot from stageRef / monitor DOM elements */
export async function captureStageSnapshot(
  stageElement: HTMLElement | null,
  compName: string,
  time: number,
  frameWidth = 1920,
  frameHeight = 1080
): Promise<FxSnapshot | null> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = frameWidth;
    canvas.height = frameHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Fill neutral dark background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, frameWidth, frameHeight);

    if (stageElement) {
      // Find video and image elements currently rendered in stage
      const mediaElements = stageElement.querySelectorAll<HTMLVideoElement | HTMLImageElement>('video, img');
      const stageRect = stageElement.getBoundingClientRect();

      for (const el of Array.from(mediaElements)) {
        try {
          const rect = el.getBoundingClientRect();
          const relX = ((rect.left - stageRect.left) / stageRect.width) * frameWidth;
          const relY = ((rect.top - stageRect.top) / stageRect.height) * frameHeight;
          const relW = (rect.width / stageRect.width) * frameWidth;
          const relH = (rect.height / stageRect.height) * frameHeight;

          ctx.drawImage(el, relX, relY, relW, relH);
        } catch {
          // Cross-origin or temporary paint issue
        }
      }

      // If no media elements or black stage, fallback draw placeholder text/graphic
      if (mediaElements.length === 0) {
        ctx.fillStyle = '#1e1e24';
        ctx.fillRect(0, 0, frameWidth, frameHeight);
        ctx.fillStyle = '#555566';
        ctx.font = 'bold 48px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${compName} frame @ ${time.toFixed(2)}s`, frameWidth / 2, frameHeight / 2);
      }
    }

    const dataUrl = canvas.toDataURL('image/png');
    const snapshot: FxSnapshot = {
      id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      time,
      compName,
      width: frameWidth,
      height: frameHeight,
      dataUrl,
      label: `Snapshot ${new Date().toLocaleTimeString()}`,
    };

    return snapshot;
  } catch (err) {
    console.error('Snapshot capture error', err);
    return null;
  }
}

/** Download snapshot as PNG or JPG */
export function downloadSnapshotFile(snapshot: FxSnapshot, format: 'png' | 'jpg' = 'png', quality = 0.95): void {
  const canvas = document.createElement('canvas');
  canvas.width = snapshot.width;
  canvas.height = snapshot.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0);
    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const finalDataUrl = canvas.toDataURL(mime, quality);
    const a = document.createElement('a');
    a.href = finalDataUrl;
    const cleanComp = (snapshot.compName || 'Snapshot').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `${cleanComp}_${snapshot.time.toFixed(2)}s_${Date.now()}.${format}`;
    a.click();
  };
  img.src = snapshot.dataUrl;
}

export type ColorSample = {
  r: number;
  g: number;
  b: number;
  a: number;
  hex: string;
  rgbStr: string;
  hslStr: string;
};

/** Interactive eyedropper pixel color sampler */
export function samplePixelColor(
  dataUrl: string,
  normX: number, // 0 to 1
  normY: number  // 0 to 1
): Promise<ColorSample> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 100;
        canvas.height = img.naturalHeight || 100;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject('No canvas context');

        ctx.drawImage(img, 0, 0);
        const px = Math.floor(Math.max(0, Math.min(canvas.width - 1, normX * canvas.width)));
        const py = Math.floor(Math.max(0, Math.min(canvas.height - 1, normY * canvas.height)));
        const p = ctx.getImageData(px, py, 1, 1).data;

        const r = p[0];
        const g = p[1];
        const b = p[2];
        const a = p[3] / 255;

        const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
        const rgbStr = `rgb(${r}, ${g}, ${b})`;

        // Calculate HSL
        const rn = r / 255;
        const gn = g / 255;
        const bn = b / 255;
        const max = Math.max(rn, gn, bn);
        const min = Math.min(rn, gn, bn);
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;

        if (max !== min) {
          const d = max - min;
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          switch (max) {
            case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
            case gn: h = (bn - rn) / d + 2; break;
            case bn: h = (rn - gn) / d + 4; break;
          }
          h /= 6;
        }

        const hslStr = `hsl(${Math.round(h * 360)}°, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;

        resolve({ r, g, b, a, hex, rgbStr, hslStr });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject('Image load failed');
    img.src = dataUrl;
  });
}
