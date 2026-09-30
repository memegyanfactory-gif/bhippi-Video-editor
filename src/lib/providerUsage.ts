import { useEffect, useState } from 'react';
import { api, errorText } from './ipc';
import { recordAccountLimits } from './usage';

export type ProviderReading = Awaited<ReturnType<typeof api.providerUsage>>;
export function windowLabel(minutes: number | null | undefined, fallback: string) {
  if (minutes === 10080) return 'Weekly';
  if (minutes && minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  if (minutes) return `${minutes}-minute limit`;
  return fallback;
}
export function useProviderUsage(providerId: string | undefined, sessionId: string | undefined, running: boolean) {
  const key = `${providerId ?? ''}:${sessionId ?? ''}`;
  const [state, setState] = useState<{ key: string; data: ProviderReading | null; loading: boolean; error: string }>({ key: '', data: null, loading: false, error: '' });
  useEffect(() => {
    if (providerId !== 'codex') return;
    let alive = true, fetching = false;
    const read = async () => {
      if (fetching) return;
      fetching = true;
      setState((held) => ({ key, data: held.key === key ? held.data : null, loading: true, error: '' }));
      try {
        const data = await api.providerUsage(providerId, sessionId);
        if (!alive) return;
        const main = data.limits.find((bucket) => bucket.id === 'codex') ?? data.limits[0];
        if (main) recordAccountLimits(providerId, main.primary, main.secondary, data.checkedAt, `${windowLabel(main.primary?.minutes, 'Session limit')} · ${main.label.toLowerCase()}`, `${windowLabel(main.secondary?.minutes, 'Longer limit')} · ${main.label.toLowerCase()}`);
        setState((held) => ({ key, data: { ...data, context: data.context ?? (held.key === key ? held.data?.context ?? null : null) }, loading: false, error: data.error ?? '' }));
      } catch (error) { if (alive) setState((held) => ({ key, data: held.key === key ? held.data : null, loading: false, error: errorText(error) })); }
      finally { fetching = false; }
    };
    void read();
    const timer = window.setInterval(() => void read(), running && sessionId ? 5000 : 45000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [providerId, sessionId, running, key]);
  return state.key === key ? state : { key, data: null, loading: providerId === 'codex', error: '' };
}
