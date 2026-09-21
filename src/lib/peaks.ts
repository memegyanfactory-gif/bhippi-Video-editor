// Numeric audio peaks for the timeline waveform. The backend writes one `<id>-peaks.bin` per
// asset: two bytes per bucket — [peak, rms], 0..255 where 255 is full scale — at exactly
// BUCKETS_PER_SECOND buckets per second of source. Drawing from numbers instead of stretching a
// PNG is what keeps the waveform crisp at every zoom level.
import { useEffect, useState } from 'react';
import { fileSrc } from './ipc';

export const BUCKETS_PER_SECOND = 100;

export type Peaks = { data: Uint8Array; buckets: number };

const cache = new Map<string, Peaks>();
const inflight = new Map<string, Promise<Peaks | null>>();
// Bumped whenever a load finishes, so every waveform on screen re-renders once its data lands.
const listeners = new Set<() => void>();

const load = (path: string): Promise<Peaks | null> => {
  const existing = inflight.get(path);
  if (existing) return existing;
  const job = fetch(fileSrc(path))
    .then(async (response) => {
      if (!response.ok) return null;
      const data = new Uint8Array(await response.arrayBuffer());
      const peaks: Peaks = { data, buckets: Math.floor(data.length / 2) };
      cache.set(path, peaks);
      for (const listener of listeners) listener();
      return peaks;
    })
    .catch(() => null)
    .finally(() => inflight.delete(path));
  inflight.set(path, job);
  return job;
};

/** The peaks for `path`, loading them on first use. `null` until they are ready (or if they fail). */
export const usePeaks = (path: string | null | undefined): Peaks | null => {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!path || cache.has(path)) return;
    const listener = () => bump((value) => value + 1);
    listeners.add(listener);
    void load(path);
    return () => {
      listeners.delete(listener);
    };
  }, [path]);
  return path ? cache.get(path) ?? null : null;
};

/**
 * The loudest peak and mean rms over a slice of source time, both 0..1 — one column of a waveform.
 * Reading the maximum (not an average) over the slice is why quiet transients stay visible when
 * the whole clip is zoomed down to a few pixels.
 */
export const sliceLevel = (peaks: Peaks, from: number, to: number): { peak: number; rms: number } => {
  const first = Math.max(0, Math.floor(from * BUCKETS_PER_SECOND));
  const last = Math.min(peaks.buckets - 1, Math.max(first, Math.ceil(to * BUCKETS_PER_SECOND) - 1));
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (let index = first; index <= last; index++) {
    const value = peaks.data[index * 2];
    if (value > peak) peak = value;
    sum += peaks.data[index * 2 + 1];
    count++;
  }
  return { peak: peak / 255, rms: count ? sum / count / 255 : 0 };
};
