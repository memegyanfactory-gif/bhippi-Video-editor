// What the Downloads page shows, worked out from the queue (model_library/queue_run.rs) and the
// live jobs: which section each download belongs in, and the plain-words lines on its row.
import type { Job } from '../../lib/types';
import type { QueueRow } from '../../lib/modelLibrary';

export type DownloadGroups = {
  /** Running (or being checked): shown with a progress bar. */
  downloading: QueueRow[];
  /** Waiting, in line order. */
  queued: QueueRow[];
  paused: QueueRow[];
  failed: QueueRow[];
  /** The last few that finished, newest first. */
  finished: QueueRow[];
};

export const groupQueue = (rows: QueueRow[]): DownloadGroups => ({
  downloading: rows.filter((row) => row.state === 'running' || row.state === 'verifying'),
  queued: rows.filter((row) => row.state === 'queued').sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
  paused: rows.filter((row) => row.state === 'paused'),
  failed: rows.filter((row) => row.state === 'failed'),
  finished: rows.filter((row) => row.state === 'done').sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)),
});

/** Job kinds that are downloads or installs, as in the corner badge. */
const DOWNLOAD_KINDS = new Set(['model', 'ai-pack', 'install']);

/**
 * Downloads that are not in the queue (engines, the AI pack, voices, speech models): they run
 * through their own installers, so they cannot wait in line, but they are listed and can be stopped.
 */
export const otherDownloads = (jobs: Job[], rows: QueueRow[]): Job[] => {
  const queued = new Set(rows.map((row) => row.jobId).filter((id): id is string => !!id));
  return jobs.filter((job) => DOWNLOAD_KINDS.has(job.kind) && job.status === 'running' && !queued.has(job.id) && /^(Downloading|Installing|Updating)\s/.test(job.label));
};

/** "Downloading Whisper large v3 turbo" → "Whisper large v3 turbo". */
export const jobName = (job: Job): string => job.label.replace(/^(Downloading|Installing|Updating)\s+/, '');

/** How many downloads are in motion or waiting: the number on the rail. */
export const activeCount = (rows: QueueRow[], others: Job[] = []): number =>
  rows.filter((row) => row.state === 'running' || row.state === 'verifying' || row.state === 'queued').length + others.length;

const UNITS: [number, string][] = [[1e12, 'TB'], [1e9, 'GB'], [1e6, 'MB'], [1e3, 'KB']];

const unitOf = (bytes: number): [number, string] => UNITS.find(([size]) => bytes >= size) ?? [1, 'B'];

const digits = (value: number, unit: string) => (unit === 'GB' || unit === 'TB' ? value.toFixed(1) : String(Math.round(value)));

/** "1.2 of 5.0 GB": both numbers in the unit of the total. */
export const sizePair = (done: number, total: number): string => {
  const [size, unit] = unitOf(total || done);
  return total > 0 ? `${digits(Math.min(done, total) / size, unit)} of ${digits(total / size, unit)} ${unit}` : `${digits(done / size, unit)} ${unit}`;
};

export const formatSpeed = (bytesPerSecond: number): string => {
  if (!(bytesPerSecond > 0)) return '';
  const [size, unit] = unitOf(bytesPerSecond);
  return `${bytesPerSecond >= 1e9 ? (bytesPerSecond / size).toFixed(1) : Math.round(bytesPerSecond / size)} ${unit}/s`;
};

/** "under a minute", "2 min left", "1 h 5 min left". */
export const formatTimeLeft = (seconds: number | null): string => {
  if (seconds == null || !(seconds > 0)) return '';
  if (seconds < 60) return 'under a minute left';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
};

/** The line under a running download: "1.2 of 5.0 GB · 38 MB/s · 2 min left". */
export const progressLine = (row: Pick<QueueRow, 'state' | 'bytesDone' | 'bytesTotal' | 'speed' | 'etaSeconds'>): string => {
  if (row.state === 'verifying') return 'Checking the file is complete…';
  if (row.bytesDone <= 0 && !(row.speed > 0)) return 'Starting…';
  return [sizePair(row.bytesDone, row.bytesTotal), formatSpeed(row.speed), formatTimeLeft(row.etaSeconds)].filter(Boolean).join(' · ');
};

/** Where a paused download stopped: "Paused at 1.2 of 5.0 GB", or "Paused, nothing fetched yet". */
export const pausedLine = (row: Pick<QueueRow, 'bytesDone' | 'bytesTotal'>): string =>
  row.bytesDone > 0 ? `Paused at ${sizePair(row.bytesDone, row.bytesTotal)}` : 'Paused, nothing fetched yet';

/** The size name next to the model's name: "Q4 · 5.0 GB", or just the size. */
export const variantLine = (row: Pick<QueueRow, 'variantLabel' | 'bytesTotal'>): string =>
  [row.variantLabel, row.bytesTotal > 0 ? sizePair(row.bytesTotal, row.bytesTotal).replace(/^(.*) of /, '') : ''].filter(Boolean).join(' · ');

/** A failure in plain words: the backend's reason, or a general line when it gave none. */
export const failureText = (error: string | null): string => {
  const text = (error ?? '').trim();
  if (!text) return 'The download stopped. Retry continues from where it got to.';
  if (/not enough|space|disk full/i.test(text)) return `${text} Free some space, then retry.`;
  return /[.!?]$/.test(text) ? text : `${text}.`;
};

/** "Finished 5 min ago" from unix seconds. */
export const finishedAgo = (at: number | null, nowMs: number = Date.now()): string => {
  if (!at) return 'Finished';
  const seconds = Math.max(0, Math.round(nowMs / 1000 - at));
  if (seconds < 60) return 'Finished just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Finished ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Finished ${hours} h ago`;
  return `Finished ${Math.round(hours / 24)} d ago`;
};
