// Background jobs (exports, downloads, generation, transcription, proxies) outside React state.
//
// A running job reports progress many times a second. Kept in App's state, every one of those
// re-rendered the whole editor — Program monitor, timeline, bin, panels: ~22 ms each on a
// 70-clip timeline, a dropped frame or two per tick, which is the preview stuttering "sometimes"
// (whenever the AI had a download or generation running). Progress now lives here and only the
// components that draw it subscribe (LiveJobs); App hears about a job only when it starts or
// changes status.

import { createElement, Fragment, useSyncExternalStore, type ReactNode } from 'react';
import type { Job } from './types';

type Listener = () => void;

let jobs: Record<string, Job> = {};
let list: Job[] = [];
const listeners = new Set<Listener>();

const publish = () => {
  list = Object.values(jobs);
  listeners.forEach((listener) => listener());
};

export const jobsStore = {
  /** Every job, as of the latest update (a new array only when something changed). */
  list: () => list,
  get: (id: string): Job | undefined => jobs[id],
  /** Replaces everything (startup). */
  reset(next: Job[]) {
    jobs = Object.fromEntries(next.map((job) => [job.id, job]));
    publish();
  },
  /**
   * Records one update. Returns true when it matters beyond a progress bar: a job that is new, or
   * whose status changed (running → done, error, cancelled).
   */
  put(job: Job): boolean {
    const previous = jobs[job.id];
    jobs = { ...jobs, [job.id]: job };
    publish();
    return !previous || previous.status !== job.status;
  },
  remove(id: string) {
    if (!(id in jobs)) return;
    const { [id]: _gone, ...rest } = jobs;
    void _gone;
    jobs = rest;
    publish();
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** The live job list; re-renders its caller on every update, progress included. */
export const useLiveJobs = () => useSyncExternalStore(jobsStore.subscribe, jobsStore.list, jobsStore.list);

/** Renders `children` with the live job list, so only that subtree follows progress. */
export function LiveJobs({ children }: { children: (jobs: Job[]) => ReactNode }) {
  const live = useLiveJobs();
  return createElement(Fragment, null, children(live));
}
