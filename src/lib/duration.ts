/**
 * How long something took or has been running, the way a person says it: tenths under ten
 * seconds, whole seconds under a minute, then minutes and seconds, then hours and minutes, then
 * days and hours. "3.1s", "42s", "2m 05s", "2h 54m", "1d 3h". Seconds stop counting once an hour
 * has gone by: nobody reads "174m 28s". `tenths: false` drops the tenths, for a clock that
 * ticks once a second.
 */
export function formatDuration(ms: number, { tenths = true }: { tenths?: boolean } = {}): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  if (ms < 10_000 && tenths) return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * Adds one stretch of running time to a total. Work that runs in bursts (think, pause for a tool,
 * think again) adds each burst on its own, so pauses in between do not count. A clock that ran
 * backwards adds nothing.
 */
export function addStretch(total: number, startedAt: number, endedAt: number): number {
  return total + Math.max(0, endedAt - startedAt);
}
