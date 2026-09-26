// Cloud image/video generation through the user's own connector keys (Settings › Connectors).
// The catalogue, the keys and every HTTP call live in Rust (src-tauri/src/gen_cloud.rs); this is the
// typed door to it plus the small pure helpers the settings page, the onboarding and the AI share.
import { invoke } from '@tauri-apps/api/core';
import type { CloudGenerationPrefs, Settings } from './types';

export type GenMode = 'text' | 'image';

export type GenModel = {
  id: string;
  label: string;
  kind: 'video' | 'image';
  /** text: prompt only · image: animates / edits from reference images. */
  modes: GenMode[];
  /** How many reference images it accepts (0 = none). */
  maxRefs: number;
  /** Clip lengths it accepts, in seconds (video). */
  durations: number[];
  aspects: string[];
  /** 1–5, the same scale as the local model meter. */
  quality: number;
  note?: string | null;
};

export type GenConnector = {
  id: string;
  label: string;
  tagline: string;
  site: string;
  keyUrl: string;
  docsUrl: string;
  keyLabel: string;
  /** Some services issue a key id and a secret; null when one key is enough. */
  secretLabel: string | null;
  keyHint: string;
  /** A key is filed in the OS credential store. The key itself never comes back. */
  saved: boolean;
  models: GenModel[];
};

export type GenRequest = {
  connector: string;
  model: string;
  kind: 'video' | 'image';
  prompt: string;
  negativePrompt?: string;
  /** Imported image assets used as references (first frame / style / subject). */
  referenceAssetIds?: string[];
  duration?: number;
  aspect?: string;
  seed?: number;
};

export const genApi = {
  connectors: () => invoke<GenConnector[]>('gen_connectors'),
  setKey: (id: string, key: string, secret?: string) => invoke<GenConnector[]>('gen_connector_set_key', { id, key, secret: secret ?? null }),
  test: (id: string) => invoke<{ ok: boolean; message: string }>('gen_connector_test', { id }),
  generate: (request: GenRequest) => invoke<string>('gen_cloud_generate', { request }),
};

export const logoOf = (id: string) => `/connectors/${id}.png`;

export function cloudPrefs(settings: Settings): Required<Pick<CloudGenerationPrefs, 'enabled' | 'connectors' | 'confirm'>> & CloudGenerationPrefs {
  const prefs = settings.cloudGeneration ?? {};
  return { ...prefs, enabled: prefs.enabled ?? false, connectors: prefs.connectors ?? {}, confirm: prefs.confirm ?? true };
}

/** A connector the AI may use right now: master switch on, key saved, connector not switched off. */
export function usableConnectors(settings: Settings, rows: GenConnector[]): GenConnector[] {
  const prefs = cloudPrefs(settings);
  if (!prefs.enabled) return [];
  return rows.filter((row) => row.saved && prefs.connectors[row.id]?.enabled !== false);
}

/**
 * The connector and model for a job: an explicit `connector:model` wins, then the saved default
 * for that kind, then each usable connector's chosen model, then its best model of the kind.
 * Reference images narrow it to models that take them.
 */
export function pickModel(settings: Settings, rows: GenConnector[], kind: 'video' | 'image', wantRefs: boolean, explicit?: string | null): { connector: GenConnector; model: GenModel } | null {
  const usable = usableConnectors(settings, rows);
  const prefs = cloudPrefs(settings);
  const fits = (model: GenModel) => model.kind === kind && (!wantRefs || model.modes.includes('image'));
  const lookup = (ref: string | null | undefined) => {
    if (!ref) return null;
    const [cid, ...rest] = ref.split(':');
    const connector = usable.find((row) => row.id === cid);
    const model = connector?.models.find((m) => m.id === rest.join(':'));
    return connector && model && fits(model) ? { connector, model } : null;
  };
  const first = lookup(explicit) ?? lookup(kind === 'video' ? prefs.defaultVideo : prefs.defaultImage);
  if (first) return first;
  for (const connector of usable) {
    const chosen = prefs.connectors[connector.id]?.[kind === 'video' ? 'videoModel' : 'imageModel'];
    const model = connector.models.find((m) => m.id === chosen && fits(m));
    if (model) return { connector, model };
  }
  let best: { connector: GenConnector; model: GenModel } | null = null;
  for (const connector of usable) for (const model of connector.models) if (fits(model) && (!best || model.quality > best.model.quality)) best = { connector, model };
  return best;
}

/** One clip or image the AI wants to generate, as the plan card shows and edits it. */
export type GenPlanItem = {
  /** Stable key for the card. */
  key: string;
  kind: 'video' | 'image';
  prompt: string;
  negativePrompt?: string;
  /** Imported image assets used as the start frame / reference. */
  referenceAssetIds: string[];
  connector: string;
  model: string;
  duration?: number;
  aspect?: string;
  /** What the clip is for — the beat or scene — in the AI's words. */
  purpose?: string;
  sceneIndex?: number;
  /** The editor struck it from the plan. */
  skip?: boolean;
};

export type GenPlan = { reason?: string; items: GenPlanItem[] };

/** The one-line source the card shows: from a prompt, or from which reference image. */
export function sourceLine(item: GenPlanItem, assetName: (id: string) => string | undefined): string {
  if (!item.referenceAssetIds.length) return item.kind === 'video' ? 'Text to video · from this prompt' : 'Text to image · from this prompt';
  const names = item.referenceAssetIds.map((id) => assetName(id) ?? 'missing image').join(', ');
  return item.kind === 'video' ? `Image to video · animates ${names}` : `Image reference · ${names}`;
}
