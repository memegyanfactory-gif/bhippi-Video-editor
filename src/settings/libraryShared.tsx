// Small pieces the Model Library pages share: the categories, the thumbnail (a bundled picture,
// the cached one, or the category's own artwork, never a broken image), the fit dot, the status of
// a model, the sizes people see, and live download progress.
import { convertFileSrc } from '@tauri-apps/api/core';
import { Boxes, Film, Image as ImageIcon, Mic, Music, Scissors, Volume2, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { HardwareInfo } from '../lib/ipc';
import { defaultVariant, formatBytes, formatEta, variantBytes } from '../lib/modelFit';
import type { FitResult } from '../lib/modelFit';
import { libraryApi, onQueueChange, type LibraryCapability, type LibraryKind, type LibraryVariant, type LibraryView } from '../lib/modelLibrary';
import type { Job } from '../lib/types';

export type Category = { id: LibraryKind; label: string; /** Shorter, for the rail. */ short: string; icon: LucideIcon; capability: LibraryCapability; blurb: string };

/** The rail's categories, in the order people think of them. The capability is the AI job a model of that kind does. */
export const CATEGORIES: Category[] = [
  { id: 'video', label: 'Video generation', short: 'Video generation', icon: Film, capability: 'video', blurb: 'Make clips from a prompt or a picture.' },
  { id: 'image', label: 'Image generation', short: 'Image generation', icon: ImageIcon, capability: 'image', blurb: 'Make and edit pictures.' },
  { id: 'audio', label: 'Music & sound', short: 'Music & sound', icon: Music, capability: 'audio', blurb: 'Make music and sound effects.' },
  { id: 'voice', label: 'Voice (text to speech)', short: 'Voice', icon: Volume2, capability: 'voice', blurb: 'Read a script out loud.' },
  { id: 'speech', label: 'Transcription (speech to text)', short: 'Transcription', icon: Mic, capability: 'speech', blurb: 'Turn speech into captions and transcripts.' },
  { id: 'matte', label: 'Cutouts & tracking', short: 'Cutouts & tracking', icon: Scissors, capability: 'roto', blurb: 'Cut out people, track and erase.' },
  { id: 'llm', label: 'Language models', short: 'Language models', icon: Boxes, capability: 'llm', blurb: 'Chat models that run on this computer.' },
];

export const CATEGORY_BY_KIND = Object.fromEntries(CATEGORIES.map((row) => [row.id, row])) as Record<LibraryKind, Category>;
export const CATEGORY_BY_CAPABILITY = Object.fromEntries(CATEGORIES.map((row) => [row.capability, row])) as Record<LibraryCapability, Category>;
export const KIND_ICONS = Object.fromEntries(CATEGORIES.map((row) => [row.id, row.icon])) as Record<LibraryKind, LucideIcon>;

/** The picture every category falls back to (bundled in public/library-thumbs). */
export const fallbackThumb = (kind: LibraryKind) => `/library-thumbs/_${kind}.svg`;

/** Cached picture paths for the whole session; `null` means "asked, none", so we never ask twice. */
const cache = new Map<string, string | null>();
const asking = new Map<string, Promise<string | null>>();

const loadCached = (view: LibraryView): Promise<string | null> => {
  const id = view.entry.id;
  const known = cache.get(id);
  if (known !== undefined) return Promise.resolve(known);
  if (view.thumbnailPath) {
    cache.set(id, view.thumbnailPath);
    return Promise.resolve(view.thumbnailPath);
  }
  if (!view.entry.thumbnail?.url) {
    cache.set(id, null);
    return Promise.resolve(null);
  }
  let pending = asking.get(id);
  if (!pending) {
    pending = libraryApi.thumbnail(id)
      .then((path) => { cache.set(id, path); return path; })
      .catch(() => null)
      .finally(() => asking.delete(id));
    asking.set(id, pending);
  }
  return pending;
};

/** The pictures to try, best first: the bundled one, the cached remote one, then the category artwork. */
const useThumbnailSources = (view: LibraryView): string[] => {
  const bundled = view.entry.thumbnail?.src ?? null;
  const [cached, setCached] = useState<string | null>(null);
  useEffect(() => {
    if (bundled) return undefined;
    let live = true;
    void loadCached(view).then((path) => { if (live) setCached(path ? convertFileSrc(path) : null); });
    return () => { live = false; };
  }, [view, bundled]);
  return useMemo(() => [bundled, cached, fallbackThumb(view.entry.kind)].filter((src): src is string => !!src), [bundled, cached, view.entry.kind]);
};

/** A 16:9 picture of the model. It steps down its list when one fails to load, and ends on a quiet icon, never a broken image. */
export function Thumb({ view, className = '' }: { view: LibraryView; className?: string }) {
  const sources = useThumbnailSources(view);
  const [failed, setFailed] = useState(0);
  const key = sources.join('|');
  useEffect(() => setFailed(0), [key]);
  const src = sources[failed];
  const Icon = KIND_ICONS[view.entry.kind];
  return (
    <span className={`ml-thumb ${className}`} aria-hidden="true">
      {src
        ? <img src={src} alt="" decoding="async" draggable={false} onError={() => setFailed((count) => count + 1)} />
        : <Icon size={20} strokeWidth={1.5} />}
    </span>
  );
}

export function FitDot({ fit }: { fit: FitResult }) {
  const tone = fit.fit === 'great' || fit.fit === 'ok' ? 'ok' : fit.fit === 'slow' ? 'warn' : fit.fit === 'checking' ? 'quiet' : 'bad';
  return <span className={`ml-fit tone-${tone}`} title={fit.reasons.join(' ') || undefined}><i aria-hidden="true" />{fit.label}</span>;
}

export type ModelStatus = { id: 'none' | 'queued' | 'downloading' | 'paused' | 'ready' | 'on' | 'problem'; label: string };

// Downloads waiting their turn (model id → place in line), shared by every card and panel.
let waiting = new Map<string, { place: number; variant: string }>();
const waitListeners = new Set<() => void>();
let waitWatch: Promise<unknown> | null = null;
const readQueue = () => libraryApi.queue().then((view) => {
  const next = new Map(view.rows.filter((row) => row.state === 'queued').map((row) => [row.id, { place: row.position ?? 0, variant: row.variant }] as const));
  const same = next.size === waiting.size && [...next].every(([id, at]) => waiting.get(id)?.place === at.place && waiting.get(id)?.variant === at.variant);
  if (same) return;
  waiting = next;
  waitListeners.forEach((listener) => listener());
}).catch(() => undefined);

/** Re-renders the caller when the download queue changes, so `statusOf` can say "Queued". */
export const useQueueWatch = () => {
  const [, bump] = useState(0);
  useEffect(() => {
    const listener = () => bump((n) => n + 1);
    waitListeners.add(listener);
    if (!waitWatch) waitWatch = onQueueChange(() => void readQueue()).catch(() => undefined);
    void readQueue();
    return () => { waitListeners.delete(listener); };
  }, []);
};

/** Where a model stands, in the words the card and the panel show. `inUse` is true when a job uses it. */
export const statusOf = (view: LibraryView, job: Job | undefined, inUse = false): ModelStatus => {
  const { state } = view;
  if (state.broken) return { id: 'problem', label: 'Problem' };
  const wait = waiting.get(view.entry.id);
  if (wait && job?.status !== 'running') return { id: 'queued', label: wait.place > 0 ? `Queued · #${wait.place}` : 'Queued' };
  if (state.download && (!job || job.status === 'running')) {
    const pct = job ? Math.round(job.progress * 100) : state.download.bytesTotal ? Math.round((state.download.bytesDone / state.download.bytesTotal) * 100) : 0;
    return { id: 'downloading', label: `Downloading ${pct}%` };
  }
  if (state.installedVariant) return inUse ? { id: 'on', label: 'In use' } : { id: 'ready', label: 'Downloaded' };
  if (state.partialBytes > 0) return { id: 'paused', label: 'Paused' };
  return { id: 'none', label: 'Not downloaded' };
};

/** `statusOf` for one size of a card that can have several on disk at once (Strata): only that size's download and files count. */
export const statusOfSize = (view: LibraryView, job: Job | undefined, size: string | null): ModelStatus => {
  const { state } = view;
  // A card with one size: the card's status is that size's.
  if (!size || view.entry.variants.length <= 1) return statusOf(view, job);
  const here = state.installedVariants?.includes(size) || state.installedVariant === size;
  if (state.download && state.download.variant === size && (!job || job.status === 'running')) return statusOf(view, job);
  const wait = waiting.get(view.entry.id);
  if (wait && wait.variant === size && job?.status !== 'running') return statusOf(view, job);
  if (here) return state.broken ? { id: 'problem', label: 'Problem' } : { id: 'ready', label: 'Downloaded' };
  return { id: 'none', label: 'Not downloaded' };
};

export function StatusPill({ status }: { status: ModelStatus }) {
  if (status.id === 'none') return null;
  return <span className={`ml-pill s-${status.id}`}>{status.label}</span>;
}

/** The variant the card speaks for: the installed one, else the one this PC should start with. */
export const shownVariant = (view: LibraryView, hw: HardwareInfo | null): LibraryVariant | undefined =>
  view.entry.variants.find((row) => row.id === view.state.installedVariant) ?? defaultVariant(view.entry.variants, hw, view.entry.runtime);

/** Size text for a card: the installed size, the default size, or "from X" when sizes differ. Empty when unknown. */
export const sizeText = (view: LibraryView, hw: HardwareInfo | null): string => {
  const installed = view.entry.variants.find((row) => row.id === view.state.installedVariant);
  if (installed) return variantBytes(installed) > 0 ? formatBytes(variantBytes(installed)) : '';
  const sizes = view.entry.variants.map((row) => variantBytes(row)).filter((bytes) => bytes > 0);
  if (!sizes.length) return '';
  if (sizes.length > 1 && new Set(sizes).size > 1) return `from ${formatBytes(Math.min(...sizes))}`;
  const shown = shownVariant(view, hw);
  return shown && variantBytes(shown) > 0 ? formatBytes(variantBytes(shown)) : formatBytes(sizes[0]);
};

/** Bytes done, total, a smoothed speed and the time left for one download, from the job and the last listing. */
export const useDownloadProgress = (view: LibraryView, job: Job | undefined) => {
  const download = view.state.download;
  const total = download?.bytesTotal ?? 0;
  const done = job && total ? Math.min(total, Math.round(job.progress * total)) : download?.bytesDone ?? 0;
  const sample = useRef<{ at: number; bytes: number; speed: number } | null>(null);
  const [speed, setSpeed] = useState(0);
  useEffect(() => {
    if (!download) { sample.current = null; setSpeed(0); return; }
    const now = Date.now();
    const last = sample.current;
    if (!last) { sample.current = { at: now, bytes: done, speed: 0 }; return; }
    const dt = (now - last.at) / 1000;
    if (dt < 1 || done < last.bytes) return;
    const instant = (done - last.bytes) / dt;
    const smooth = last.speed ? last.speed * 0.7 + instant * 0.3 : instant;
    sample.current = { at: now, bytes: done, speed: smooth };
    setSpeed(smooth);
  }, [download, done]);
  return { done, total, speed, eta: total ? formatEta(total - done, speed) : null, fraction: total ? done / total : job?.progress ?? 0 };
};
