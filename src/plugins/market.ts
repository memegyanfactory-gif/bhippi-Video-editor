// The plugin marketplace from inside Bhippi (docs/PLUGIN-PLATFORM-PLAN.md, Phase 4). The app side
// of bhippi.com's /api/plugins (the website's functions/_lib/plugins/routes.ts), reached through
// Rust (src-tauri/src/market.rs), which verifies every download's signature before it gets here.
//
//   browse / listing      the catalogue and one plugin, with what it may do
//   installFromMarket     a verified download → its lock must be the one bhippi.com signed →
//                         installPackage (package.ts): checked, installed off, waiting for review
//   checkRevocations      the signed revocation list: every installed version on it is turned
//                         off and can't be turned on again (store.ts patchPlugin)
//   publish               the Maker's gate (a clean draft, and a passing Judge on a real test run),
//                         then the package goes to bhippi.com for review

import { api } from '../lib/ipc';
import { saveDraft, type PluginChecker } from './aiTools';
import { draftStore, readDraft, validateDraft } from './drafts';
import { LOGO_FILE, logoImage } from './logo';
import { compareSemver, exportPackage, installPackage, parseSemver, readPackage, type InstallOutcome } from './package';
import { findPlugin, loadPlugins, patchPlugin, pluginStore } from './store';
import type { Plugin, PluginPermissions } from './types';

export const CATEGORIES = ['editing', 'automation', 'integration', 'motion', 'audio', 'captions', 'utility', 'fun'] as const;
export type Category = (typeof CATEGORIES)[number];

export type MarketPlugin = {
  id: string;
  name: string;
  summary: string;
  icon: string | null;
  /** The package's logo.svg picture (src/plugins/logo.ts), when bhippi.com sends one. */
  logo?: string | null;
  category: string;
  author: string;
  version: string | null;
  bhippi: string | null;
  size: number | null;
  updatedAt: number;
  installs: number;
  permissions: PluginPermissions | null;
  background: boolean;
  publisher: Publisher | null;
  rating: { average: number; count: number } | null;
};

export type Publisher = { handle: string; name: string; verified: boolean; picture?: string | null };
/** One rating, tied to the Google account that wrote it: its first name (or publisher name) and photo. */
export type Review = { stars: number; review: string; version: string | null; at: number; by: string; picture?: string | null; handle?: string | null };
export type Reviews = {
  reviews: Review[];
  /** How many visible ratings gave 5, 4, 3, 2 and 1 stars. */
  breakdown?: number[];
  mine: { stars: number; review: string; version?: string | null; at?: number } | null;
  /** The signed-in account, or null when no Google account is connected. */
  viewer?: { name: string | null } | null;
};
export const REPORT_REASONS = [
  { id: 'malicious', label: 'It does something harmful or sneaky' },
  { id: 'privacy', label: 'It sends my data somewhere it should not' },
  { id: 'misleading', label: 'It does not do what it says' },
  { id: 'broken', label: 'It does not work' },
  { id: 'copyright', label: 'It copies someone else’s work' },
  { id: 'other', label: 'Something else' },
] as const;

export type MarketListing = { plugin: MarketPlugin & { status: string }; versions: { version: string; bhippi: string | null; size: number; approvedAt: number | null; revoked: boolean }[] };

export type Submission = { id: string; plugin: string; version: string; status: 'in_review' | 'approved' | 'rejected' | 'revoked' | 'withdrawn'; note: string | null; submittedAt: number; reviewedAt: number | null; warnings: string[]; risk: string | null };

const query = (params: Record<string, string>) => {
  const text = Object.entries(params).filter(([, value]) => value).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  return text ? `?${text}` : '';
};

export const browse = (q = '', category = '', sort: 'popular' | 'new' = 'popular') =>
  api.marketGet<{ plugins: MarketPlugin[]; categories: string[] }>(query({ q: q.trim().slice(0, 80), category, sort: sort === 'new' ? 'new' : '' }));

export const listing = (id: string) => api.marketGet<MarketListing>(`p/${id}`);

export const mySubmissions = () => api.marketGet<{ publisher: Publisher | null; listings: { id: string; name: string; status: string; latestVersion: string | null; installs: number; category: string }[]; versions: Submission[] }>('mine');

export const withdraw = (versionId: string) => api.marketWithdraw(versionId);

/** Whether a marketplace call failed because bhippi.com has no marketplace yet (market.rs MARKET_CLOSED). */
export const isClosed = (failure: unknown) => /not open on bhippi\.com yet/.test(failure instanceof Error ? failure.message : String(failure));

export const reviewsOf = (id: string) => api.marketGet<Reviews>(`p/${id}/reviews`);
/** Whether a marketplace call failed because no Google account is connected (market.rs SIGNED_OUT). */
export const isSignedOut = (failure: unknown) => /Connect your Google account|Sign in to Bhippi first/.test(failure instanceof Error ? failure.message : String(failure));
/** One rating per account per plugin; rating again replaces it. */
export const rate = (id: string, stars: number, review: string, version?: string) => api.marketPost(`p/${id}/rate`, { stars, review: review.trim().slice(0, 1000), version });
export const reportPlugin = (id: string, reason: (typeof REPORT_REASONS)[number]['id'], details: string, version?: string) => api.marketPost(`p/${id}/report`, { reason, details: details.trim().slice(0, 2000), version });
export type MyAccount = { name: string; email: string; picture: string | null };
export const myPublisher = () => api.marketGet<{ publisher: (Publisher & { bio: string }) | null; account?: MyAccount; suggestedName: string }>('publisher');
export const savePublisher = (handle: string, displayName: string, bio: string) =>
  api.marketPost<{ publisher: (Publisher & { bio: string }) | null; account?: MyAccount; suggestedName: string }>('publisher', { handle: handle.trim().toLowerCase(), displayName: displayName.trim(), bio: bio.trim() });

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

/** Whether the marketplace has a newer version than the one installed. */
export function updateFor(plugin: Plugin, market: MarketPlugin | undefined): string | null {
  if (!plugin.pkg || !market?.version) return null;
  const [have, offered] = [parseSemver(plugin.pkg.version), parseSemver(market.version)];
  return have && offered && compareSemver(offered, have) > 0 ? market.version : null;
}

/** Installs (or updates to) a marketplace version. Rust verified the signature; this checks the lock is the signed one. */
export async function installFromMarket(id: string, version: string, known: ReadonlySet<string>): Promise<InstallOutcome> {
  const download = await api.marketDownload(id, version);
  const bytes = fromBase64(download.bytes);
  const read = await readPackage(bytes);
  if (read.lockHash !== download.lockHash) throw new Error(`The files inside “${id}” ${version} are not the ones bhippi.com approved. Nothing was installed.`);
  if (read.manifest?.id !== id || read.manifest.version !== version) throw new Error(`The download is not “${id}” ${version}. Nothing was installed.`);
  return installPackage(bytes, 'marketplace', known);
}

/**
 * Applies bhippi.com's signed revocation list: every installed version it names is turned off and
 * marked, whatever it was installed from. Returns the plugins it turned off.
 */
export async function checkRevocations(): Promise<{ plugin: Plugin; reason: string }[]> {
  await loadPlugins();
  const list = await api.marketRevocations();
  const pulled: { plugin: Plugin; reason: string }[] = [];
  for (const plugin of pluginStore.get().plugins) {
    if (!plugin.pkg || plugin.revoked) continue;
    const entry = list.entries.find((item) => item.id === plugin.id && (item.version === '*' || item.version === plugin.pkg!.version));
    if (!entry) continue;
    await patchPlugin(plugin.id, { enabled: false, revoked: { reason: entry.reason, at: entry.revokedAt } });
    pulled.push({ plugin, reason: entry.reason });
  }
  return pulled;
}

export type PublishStep = 'checking' | 'testing' | 'packing' | 'sending';
/**
 * What the publisher fills in: it goes into the plugin itself (its manifest and logo.svg), so the
 * signed package carries it and the listing shows exactly that. `logo` is a logo file's text
 * (logo.ts), null to remove the logo, or left out to keep it.
 */
export type ListingDetails = { name: string; description: string; icon: string; logo?: string | null };
/** How much of a description the store shows under a plugin's name. */
export const SUMMARY_LENGTH = 280;
export type PublishResult = { ok: true; versionId: string; version: string; warnings: string[] } | { ok: false; problems: string[] };

/**
 * Publishes a plugin for review. The gate is the Maker's own: a draft with no problems, and a real
 * test run the Judge passes. `version` becomes the draft manifest's version first.
 */
export async function publish(pluginId: string, options: { version: string; category: Category; details?: ListingDetails; publishAs?: string; known: ReadonlySet<string>; checker: PluginChecker | null; onStep?: (step: PublishStep) => void }): Promise<PublishResult> {
  const { version, category, details, publishAs, known, checker, onStep } = options;
  if (!parseSemver(version)) return { ok: false, problems: [`“${version}” is not a version like 1.2.0.`] };
  if (!(CATEGORIES as readonly string[]).includes(category)) return { ok: false, problems: ['Choose a category for it.'] };
  if (details) {
    const name = details.name.trim();
    if (!name || name.length > 60) return { ok: false, problems: ['Give it a name (up to 60 characters).'] };
    if (!details.description.trim()) return { ok: false, problems: ['Add a description: it is what people read before they get it.'] };
    if (details.description.trim().length > SUMMARY_LENGTH) return { ok: false, problems: [`Keep the description to ${SUMMARY_LENGTH} characters.`] };
    if ([...details.icon.trim()].length > 8) return { ok: false, problems: ['The icon is one emoji.'] };
    if (typeof details.logo === 'string' && !logoImage(details.logo)) return { ok: false, problems: ['Upload the logo again: that picture could not be used.'] };
  }
  const plugin = findPlugin(pluginId);
  if (!plugin) return { ok: false, problems: [`No plugin “${pluginId}”.`] };
  onStep?.('checking');
  const draft = await readDraft(pluginId);
  if (!Object.keys(draft).length) return { ok: false, problems: ['Open it in the Plugin Maker first: a published plugin is built from its draft (spec, code and checks).'] };
  const manifest = JSON.parse(draft['manifest.json'] ?? '{}') as Record<string, unknown>;
  const listed: Record<string, unknown> = { ...manifest, version };
  if (details) {
    listed.name = details.name.trim();
    listed.description = details.description.trim();
    if (details.icon.trim()) listed.icon = details.icon.trim();
    else delete listed.icon;
    if (typeof details.logo === 'string') draft[LOGO_FILE] = details.logo;
    else if (details.logo === null) delete draft[LOGO_FILE];
  }
  draft['manifest.json'] = `${JSON.stringify(listed, null, 2)}\n`;
  const check = validateDraft(draft, known);
  if (!check.ok) return { ok: false, problems: check.problems };
  if (!check.checks) return { ok: false, problems: ['Add acceptance checks (bhippi.test) first: the marketplace needs a plugin that proves it works.'] };
  onStep?.('testing');
  if (!checker) return { ok: false, problems: ['Plugins can only be tested, and so published, in the Bhippi app.'] };
  // What is tested is exactly what is published: the draft, saved with its new version.
  await draftStore.write(pluginId, 'manifest.json', draft['manifest.json']);
  if (draft[LOGO_FILE] !== undefined) await draftStore.write(pluginId, LOGO_FILE, draft[LOGO_FILE]);
  else await draftStore.remove(pluginId, LOGO_FILE).catch(() => undefined);
  const saved = await saveDraft(pluginId, draft, known, `Prepared ${version} for the marketplace`);
  if (!saved.ok) return { ok: false, problems: [String(saved.error)] };
  const current = findPlugin(pluginId)!;
  const run = await checker.test(current, 1500, check);
  if (!run.ok || run.pass !== true) {
    const fixes = Array.isArray(run.fixes) ? (run.fixes as string[]) : [];
    return { ok: false, problems: [`The Judge scored it ${typeof run.score === 'number' ? run.score : '—'}/100; the marketplace needs 80. Fix these first:`, ...fixes] };
  }
  onStep?.('packing');
  const { bytes } = await exportPackage(current);
  onStep?.('sending');
  const answer = await api.marketSubmit(toBase64(bytes), category, publishAs?.trim() || undefined);
  const report = answer.report as { problems?: string[]; warnings?: string[] } | undefined;
  if (answer.ok !== true) return { ok: false, problems: [String(answer.message ?? 'bhippi.com did not accept it.'), ...(report?.problems ?? [])] };
  return { ok: true, versionId: String(answer.versionId), version, warnings: report?.warnings ?? [] };
}
