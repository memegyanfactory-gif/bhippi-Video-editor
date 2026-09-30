import { Download, LoaderCircle, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, errorText } from '../lib/ipc';
import { jobsStore } from '../lib/jobsStore';
import { actionLogger } from '../lib/actionLogger';
import type { ProviderInfo } from '../lib/types';
import { ProviderLogo } from './ProviderLogo';
import '../styles/provider-updates.css';

type Update = Awaited<ReturnType<typeof api.providerUpdates>>[number];
export function ProviderUpdates({ providers, busy = false, onProviders, onModels }: { providers: ProviderInfo[]; busy?: boolean; onProviders: (providers: ProviderInfo[]) => void; onModels?: () => void }) {
  const [updates, setUpdates] = useState<Update[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState('');
  const jobs = useSyncExternalStore(jobsStore.subscribe, jobsStore.list);
  const checking = useRef(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const mounted = useRef(false);
  const previousModels = useRef<Map<string, string[]> | null>(null);
  const [modelNotices, setModelNotices] = useState<{ id: string; label: string; models: string[] }[]>([]);
  const latestProps = useRef({ busy, onProviders });
  latestProps.current = { busy, onProviders };
  useEffect(() => {
    const current = new Map(providers.filter((row) => row.usable).map((row) => [row.id, row.models]));
    const previous = previousModels.current;
    if (previous) {
      const added = providers.flatMap((row) => {
        const before = previous.get(row.id);
        const models = before ? row.models.filter((model) => !before.includes(model)) : [];
        return row.usable && models.length ? [{ id: row.id, label: row.label, models }] : [];
      });
      if (added.length) setModelNotices((held) => [...held.filter((notice) => !added.some((row) => row.id === notice.id)), ...added]);
    }
    previousModels.current = current;
  }, [providers]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (latestProps.current.busy) return;
      void api.providersRefresh().then((rows) => { if (mounted.current) latestProps.current.onProviders(rows); }).catch(() => undefined);
    }, 30 * 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const signature = providers.filter((row) => row.installed && row.kind === 'cli').map((row) => `${row.id}:${row.version}`).join('|');
  const check = useCallback(async (force = false) => {
    if (checking.current) return;
    checking.current = true;
    try { const result = await api.providerUpdates(force); if (mounted.current) setUpdates(result); }
    catch (error) { actionLogger.warn('Could not check provider updates', error); }
    finally { checking.current = false; }
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!signature) return;
    void check();
    const timer = window.setInterval(() => void check(true), 30 * 60_000);
    return () => window.clearInterval(timer);
  }, [signature, check]);
  useEffect(() => {
    if (!jobId) return;
    const job = jobs.find((row) => row.id === jobId);
    if (!job || job.status === 'running') return;
    setJobId(null); setInstalling(null);
    if (job.status === 'done') {
      setError('');
      void api.providersRefresh().then((rows) => { onProviders(rows); return check(true); }).catch((failure) => setError(errorText(failure)));
    } else setError(job.message || 'Installation failed. Try again.');
  }, [jobs, jobId, onProviders, check]);
  const install = async (update: Update) => {
    if (installing) return;
    setInstalling(update.id); setError('');
    try { setJobId(await api.providerUpdate(update.id)); }
    catch (error) { setError(errorText(error)); setInstalling(null); }
  };
  const visible = updates.filter((update) => !dismissed.has(`${update.id}:${update.latest}`));
  if (!visible.length && !modelNotices.length) return null;
  const maintaining = jobs.some((job) => job.kind === 'install' && job.status === 'running');
  return <div className="provider-update-notice" role="status" aria-live="polite">
    <div className="provider-update-heading"><Download size={14} /><strong>AI provider updates</strong><button type="button" aria-label="Dismiss provider updates" onClick={() => { setDismissed(new Set([...dismissed, ...visible.map((update) => `${update.id}:${update.latest}`)])); setModelNotices([]); }}><X size={13} /></button></div>
    {visible.map((update) => <div className="provider-update-row" key={update.id}><ProviderLogo id={update.id} size={17} />
      <div><strong>{update.label}</strong><span>{update.current} → {update.latest}</span></div>
      <button type="button" className="btn btn-small" disabled={busy || !!installing || maintaining} title={busy ? 'Available after the current AI run finishes' : 'Install this provider update'} onClick={() => void install(update)}>
        {installing === update.id ? <><LoaderCircle size={11} className="spin" /> Installing</> : 'Install'}
      </button>
    </div>)}
    {modelNotices.map((notice) => <div className="provider-update-row" key={`models:${notice.id}`}><ProviderLogo id={notice.id} size={17} /><div><strong>{notice.label}: new models available</strong><span title={notice.models.join(', ')}>{notice.models.length} added to the model list</span></div>{onModels && <button type="button" className="btn btn-small" onClick={onModels}>View models</button>}</div>)}
    {busy && <p className="provider-update-note">Install when the current AI run finishes.</p>}
    {error && <p className="provider-update-error" role="alert">{error}</p>}
  </div>;
}
