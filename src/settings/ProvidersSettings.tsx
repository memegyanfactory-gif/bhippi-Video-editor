// Settings › AI providers.
//
// Two panes: every provider this computer has down the left (name, version, one status line and
// the switch that shows it in the chat), and the chosen one's settings on the right. Only what is
// actually here is listed — a CLI on PATH, a model server that answered, a saved key; everything
// else Bhippi can reach waits behind "Add provider" instead of a wall of "not running" rows.
import { Check, ChevronDown, Download, ExternalLink, KeyRound, Link2, LoaderCircle, Play, Plus, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ProviderLogo } from '../components/ProviderLogo';
import { Toggle, useToast } from '../components/ui';
import { api, errorText } from '../lib/ipc';
import { pickerEntries } from '../lib/modelTiers';
import type { Job, ProviderInfo, Settings } from '../lib/types';
import '../styles/models.css';
import '../styles/providers.css';
import { Search, Activity } from 'lucide-react';

/** The port each local server listens on out of the box — the placeholder for a custom address. */
const DEFAULT_PORT: Record<string, number> = { ollama: 11434, lmstudio: 1234, llamacpp: 8080, vllm: 8000, jan: 1337 };

/** How to get each local server answering, for someone who has never opened its settings. */
const LOCAL_SETUP: Record<string, string> = {
  ollama: 'Install Ollama and download a model (for example `ollama pull qwen2.5`). Bhippi finds it automatically and can start it for you.',
  lmstudio: 'Install LM Studio and download a model. Bhippi finds it automatically and can switch on its local server for you.',
  jan: 'Install Jan and download a model, then in Jan open Settings → Local API Server and press Start Server.',
  llamacpp: 'Run `llama-server -m your-model.gguf`. Bhippi checks port 8080; set the address below if you use another one.',
  vllm: 'Run `vllm serve <model>`. Bhippi checks port 8000; set the address below if you use another one.',
};

/** A local server that answered but refused us for want of an API key (Jan, a keyed llama-server). */
function needsKey(row: ProviderInfo) {
  return row.kind === 'local_server' && !row.usable && row.health.state === 'unavailable' && /api key/i.test(row.health.reason);
}

/**
 * Whether this computer has the provider at all: the CLI is installed, the server answered (or
 * Ollama is on disk but stopped), or a key is saved — even a rejected one, so it can be fixed.
 */
export function isSetUp(row: ProviderInfo): boolean {
  if (row.kind === 'builtin') return true;
  if (row.kind === 'cli') return row.installed;
  if (row.kind === 'local_server') return row.installed || row.detectedPort !== null || row.offered;
  return row.installed || row.keySource !== null;
}

function status(row: ProviderInfo, installing: boolean): { tone: 'ok' | 'warn' | 'off' | 'error'; label: string } {
  if (installing) return { tone: 'warn', label: 'Installing…' };
  if (row.kind === 'builtin') return { tone: 'ok', label: 'Ready' };
  if (row.usable) return row.health.state === 'degraded' ? { tone: 'warn', label: 'Ready · offline list' } : { tone: 'ok', label: 'Ready' };
  if (row.kind === 'cli') return row.installed ? { tone: 'warn', label: 'Not signed in' } : { tone: 'off', label: 'Not installed' };
  if (row.kind === 'local_server') {
    if (needsKey(row)) return { tone: 'warn', label: 'Needs API key' };
    if (row.detectedPort) return { tone: 'warn', label: 'No model loaded' };
    if (row.offered) return { tone: 'warn', label: row.canStart ? 'Server off' : 'Not running' };
    return { tone: 'off', label: 'Not detected' };
  }
  if (row.health.state === 'unavailable') return { tone: 'error', label: 'Key rejected' };
  return { tone: 'off', label: 'Needs API key' };
}

/** "gemini-2.5 · gemini-3-preview · claude-sonnet-4-6 +11" — what the list holds, in a line. */
function modelsLine(row: ProviderInfo) {
  const entries = pickerEntries(row.models, null);
  const head = entries.slice(0, 4).map((entry) => entry.tiers.length ? `${entry.title} (${entry.tiers.map((step) => step.label).join('/')})` : entry.title);
  return `${head.join(' · ')}${entries.length > 4 ? ` +${entries.length - 4} more` : ''}`;
}

function addHint(row: ProviderInfo) {
  if (row.kind === 'cli') return 'Install';
  if (row.kind === 'local_server') return 'Not running';
  return 'Add API key';
}

/** The job provider_update_all runs under (lib.rs). */
const UPDATE_ALL_JOB = 'Updating all AI providers';

export function ProvidersSettings({ providers, onProviders, settings, onSettings, jobs, onUsage }: {
  providers: ProviderInfo[];
  onProviders: (rows: ProviderInfo[]) => void;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  jobs: Job[];
  onUsage?: () => void;
}) {
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  /** The provider whose details fill the right-hand pane. */
  const [selected, setSelected] = useState<string | null>(settings.providerId);
  /** Ticks so "Checked 4 min ago" stays true while the page is open. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const [starting, setStarting] = useState<string | null>(null);
  const [endpoints, setEndpoints] = useState<Record<string, string>>(() => ({ ...(settings.localEndpoints ?? {}) }));
  const [savingEndpoint, setSavingEndpoint] = useState<string | null>(null);
  const installing = new Set(jobs.filter((job) => job.kind === 'install' && job.status === 'running').map((job) => job.label.replace(/^(Installing|Updating) /, '')));
  const ready = providers.filter((row) => row.usable && row.kind !== 'builtin').length;
  const present = providers.filter(isSetUp);
  const absent = providers.filter((row) => !isSetUp(row));
  const matches = (row: ProviderInfo) => `${row.label} ${row.id} ${row.models.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase());

  const refresh = async () => {
    setRefreshing(true);
    try {
      onProviders(await api.providersRefresh());
    } catch (error) {
      toast({ tone: 'error', title: 'Could not refresh providers', body: errorText(error) });
    } finally {
      setRefreshing(false);
    }
  };

  const saveKey = async (row: ProviderInfo, value: string) => {
    setSavingKey(row.id);
    try {
      const rows = await api.providerSetKey(row.id, value);
      onProviders(rows);
      setKeys((current) => ({ ...current, [row.id]: '' }));
      const updated = rows.find((item) => item.id === row.id);
      if (!value.trim()) toast({ tone: 'info', title: `${row.label} key removed` });
      else if (updated?.usable) {
        toast({ tone: 'success', title: `${row.label} connected`, body: `${updated.models.length} models found` });
      } else toast({ tone: 'error', title: `${row.label} key not accepted`, body: updated?.health.state === 'unavailable' ? updated.health.reason : 'Check the key and try again.' });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not save the key', body: errorText(error) });
    } finally {
      setSavingKey(null);
    }
  };

  const start = async (row: ProviderInfo) => {
    setStarting(row.id);
    try {
      const rows = await api.providerStart(row.id);
      onProviders(rows);
      const updated = rows.find((item) => item.id === row.id);
      if (updated?.usable) toast({ tone: 'success', title: `${row.label} is ready`, body: `${updated.models.length} model${updated.models.length === 1 ? '' : 's'} found` });
      else if (updated?.detectedPort) toast({ tone: 'info', title: `${row.label} server started`, body: updated.health.state === 'degraded' || updated.health.state === 'unavailable' ? updated.health.reason : 'Download or load a model in it, then press Refresh.' });
      else toast({ tone: 'error', title: `${row.label} did not answer yet`, body: 'Give it a few seconds and press Refresh.' });
    } catch (error) {
      toast({ tone: 'error', title: `Could not start ${row.label}`, body: errorText(error) });
    } finally {
      setStarting(null);
    }
  };

  const saveEndpoint = async (row: ProviderInfo, value: string) => {
    setSavingEndpoint(row.id);
    try {
      const rows = await api.providerSetEndpoint(row.id, value);
      onProviders(rows);
      // The backend records the address in the settings itself: read them back, or the next save undoes it.
      onSettings(await api.settingsGet());
      const updated = rows.find((item) => item.id === row.id);
      if (!value.trim()) toast({ tone: 'info', title: `${row.label} back to automatic detection` });
      else if (updated?.usable) toast({ tone: 'success', title: `${row.label} connected`, body: `${updated.models.length} model${updated.models.length === 1 ? '' : 's'} found` });
      else toast({ tone: 'error', title: `Nothing usable answered at ${value.trim()}`, body: `Check that ${row.label} is running with its server started, then try again.` });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not save the address', body: errorText(error) });
    } finally {
      setSavingEndpoint(null);
    }
  };

  const install = async (row: ProviderInfo) => {
    try {
      await api.providerInstall(row.id);
      toast({ tone: 'info', title: `Installing ${row.label}`, body: row.installCommand ?? undefined });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not install', body: errorText(error) });
    }
  };

  const setEnabled = async (row: ProviderInfo, enabled: boolean) => {
    try {
      onProviders(await api.providerSetEnabled(row.id, enabled));
      // The backend records the choice in the settings itself: read them back, or the next save undoes it.
      onSettings(await api.settingsGet());
    } catch (error) {
      toast({ tone: 'error', title: 'Could not update provider', body: errorText(error) });
    }
  };

  const update = async (row: ProviderInfo) => {
    try {
      await api.providerUpdate(row.id);
      toast({ tone: 'info', title: `Updating ${row.label}`, body: 'The installed version and model list will refresh when finished.' });
    } catch (error) { toast({ tone: 'error', title: 'Could not update provider', body: errorText(error) }); }
  };

  /** The providers "Update all" updates: installed CLIs Bhippi knows how to update. The rest only re-read their models. */
  const updatable = present.filter((row) => row.kind === 'cli' && row.installed && row.installCommand);
  const allJob = jobs.filter((job) => job.kind === 'install' && job.label === UPDATE_ALL_JOB).at(-1);
  const updatingAll = allJob?.status === 'running';
  const updateAll = async () => {
    try {
      const job = await api.providerUpdateAll();
      toast(job
        ? { tone: 'info', title: `Updating ${updatable.length} AI provider${updatable.length === 1 ? '' : 's'}`, body: 'One after another; every model list refreshes when they finish.' }
        : { tone: 'success', title: 'Model lists refreshed', body: 'No installed provider needs Bhippi to update it.' });
    } catch (error) { toast({ tone: 'error', title: 'Could not update the providers', body: errorText(error) }); }
  };

  const keyForm = (row: ProviderInfo) => (
    <form className="key-form" onSubmit={(event) => { event.preventDefault(); void saveKey(row, keys[row.id] ?? ''); }}>
      <KeyRound size={13} />
      <input type="password" placeholder={row.keySource === 'keychain' ? 'Key saved — paste a new one to replace' : row.keySource === 'env' ? `Using ${row.keyEnv} — paste to override` : row.kind === 'local_server' ? `API key (only if you set one in ${row.label})` : `Paste ${row.label} key`} value={keys[row.id] ?? ''} onChange={(event) => { const value = event.target.value; setKeys((current) => ({ ...current, [row.id]: value })); }} autoComplete="off" spellCheck={false} />
      <button type="submit" className="btn btn-small" disabled={savingKey === row.id || !(keys[row.id] ?? '').trim()}>{savingKey === row.id ? <LoaderCircle size={12} className="spin" /> : 'Save'}</button>
      {row.keySource === 'keychain' && <button type="button" className="btn btn-small btn-ghost" onClick={() => void saveKey(row, '')}>Remove</button>}
    </form>
  );

  const endpointForm = (row: ProviderInfo) => {
    const saved = settings.localEndpoints?.[row.id] ?? '';
    const value = endpoints[row.id] ?? saved;
    return (
      <form className="key-form" onSubmit={(event) => { event.preventDefault(); void saveEndpoint(row, value); }}>
        <Link2 size={13} />
        <input type="text" placeholder={`Address, e.g. localhost:${DEFAULT_PORT[row.id] ?? 8080} — empty finds it automatically`} value={value} onChange={(event) => { const next = event.target.value; setEndpoints((current) => ({ ...current, [row.id]: next })); }} autoComplete="off" spellCheck={false} />
        <button type="submit" className="btn btn-small" disabled={savingEndpoint === row.id || value.trim() === saved.trim()}>{savingEndpoint === row.id ? <LoaderCircle size={12} className="spin" /> : 'Connect'}</button>
        {saved && <button type="button" className="btn btn-small btn-ghost" disabled={savingEndpoint === row.id} onClick={() => { setEndpoints((current) => ({ ...current, [row.id]: '' })); void saveEndpoint(row, ''); }}>Automatic</button>}
      </form>
    );
  };

  // The pane shows one provider at a time: the one clicked, else the first real one this computer has.
  const shown = [...present, ...absent].find((row) => row.id === selected)
    ?? present.find((row) => row.kind !== 'builtin')
    ?? present[0]
    ?? absent[0];

  const listRow = (row: ProviderInfo, setUp: boolean) => {
    const state = status(row, installing.has(row.label));
    const on = shown?.id === row.id;
    return (
      <div
        key={row.id}
        role="option"
        aria-selected={on}
        tabIndex={0}
        className={`prov-item${on ? ' on' : ''}${!setUp || (row.kind !== 'builtin' && !row.enabled) ? ' dim' : ''}`}
        onClick={() => setSelected(row.id)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(row.id); } }}
      >
        <ProviderLogo id={row.id} size={18} />
        <span className="prov-item-copy">
          <span className="prov-item-name"><b>{row.label}</b>{setUp && row.version && <code>{shortVersion(row.version)}</code>}</span>
          <span className="prov-item-status">{setUp ? statusLine(row, state.label) : addHint(row)}</span>
        </span>
        {setUp && row.kind !== 'builtin' && (
          <span className="prov-item-toggle" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <Toggle checked={row.enabled} onChange={(enabled) => void setEnabled(row, enabled)} label={`Show ${row.label} in the chat`} />
          </span>
        )}
      </div>
    );
  };

  const detail = (row: ProviderInfo) => {
    const state = status(row, installing.has(row.label));
    const setUp = isSetUp(row);
    const updateJob = jobs.filter((job) => job.kind === 'install' && [`Updating ${row.label}`, `Installing ${row.label}`].includes(job.label)).at(-1);
    const models = row.usable && row.models.length > 0 && row.kind !== 'builtin';
    return (
      <section className="prov-detail" aria-label={row.label}>
        <header className="prov-detail-head">
          <ProviderLogo id={row.id} size={18} />
          <h4>{row.label}</h4>
          {setUp && <span className={`pill tone-${state.tone}`}>{state.tone === 'ok' ? <Check size={11} /> : state.tone === 'error' ? <TriangleAlert size={11} /> : null}{state.label}</span>}
          <span className="prov-detail-spacer" />
          {row.version && <code className="prov-version">{shortVersion(row.version)}</code>}
        </header>
        <div className="prov-detail-summary"><span className={`prov-status-dot ${state.tone}`} /><span>{row.kind === 'cli' ? 'CLI runtime' : row.kind === 'cloud_api' ? 'Cloud API' : row.kind === 'local_server' ? 'Local server' : 'Offline commands'}</span>
          {settings.providerId === row.id ? <span className="prov-current">Selected in chat</span> : row.usable && <button type="button" className="btn btn-small" onClick={() => onSettings({ ...settings, providerId: row.id, model: row.models[0] ?? null })}>Use in chat</button>}
        </div>

        <div className="prov-card">
          <Field title="Status" desc={statusDetail(row, setUp)}>
            {row.homepage && (
              <button type="button" className="icon-btn small" onClick={() => void api.openUrl(row.homepage!)} title={row.kind === 'cloud_api' ? 'Manage keys' : 'Website'}><ExternalLink size={13} /></button>
            )}
          </Field>
          {setUp && row.kind !== 'builtin' && (
            <Field title="Show in chat" desc="List this provider's models in the chat's model menu.">
              <Toggle checked={row.enabled} onChange={(enabled) => void setEnabled(row, enabled)} label={`Show ${row.label} in the chat`} />
            </Field>
          )}
          {models && (
            <Field title={`${row.models.length} model${row.models.length === 1 ? '' : 's'}`} desc={<span className="provider-models-line" title={row.models.join('\n')}>{modelsLine(row)}</span>}>
              <button type="button" className="btn btn-small" disabled={refreshing} onClick={() => void refresh()} title="Re-read this provider's model list">
                {refreshing ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />} Refresh
              </button>
            </Field>
          )}
        </div>
        {models && <div className="prov-model-catalog"><h5 className="prov-section">Available models</h5><div className="prov-model-grid">{pickerEntries(row.models, null).map((entry) => <button type="button" key={entry.id} className={`prov-model${settings.providerId === row.id && settings.model === entry.id ? ' selected' : ''}`} title={entry.id}
          onClick={() => onSettings({ ...settings, providerId: row.id, model: entry.id })}><span>{entry.title}</span>{settings.providerId === row.id && settings.model === entry.id ? <Check size={12} /> : <span className="prov-model-use">Use</span>}</button>)}</div></div>}

        {row.kind === 'cli' && (
          <>
            <h5 className="prov-section">Runtime</h5>
            <div className="prov-card">
              {row.installCommand && (
                <Field title={row.installed ? 'Update' : 'Install'} desc={<code className="prov-code">{row.installCommand}</code>}>
                  {row.installed
                    ? <button type="button" className="btn btn-small" disabled={installing.size > 0} onClick={() => void update(row)}>{installing.has(row.label) ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />} Update</button>
                    : <button type="button" className="btn btn-small btn-primary" disabled={installing.has(row.label)} onClick={() => void install(row)}><Download size={12} /> Install</button>}
                </Field>
              )}
              {!row.installCommand && !row.installed && <Field title="Install" desc="Install it from its website, then press Refresh." />}
              {row.installed && row.installCommand && (
                <Field title="Auto-update" desc="Update it once a day while Bhippi is idle.">
                  <Toggle
                    checked={(settings.autoUpdateProviders ?? []).includes(row.id)}
                    onChange={(checked) => onSettings({ ...settings, autoUpdateProviders: checked ? [...new Set([...(settings.autoUpdateProviders ?? []), row.id])] : (settings.autoUpdateProviders ?? []).filter((id) => id !== row.id) })}
                    label={`Auto-update ${row.label}`}
                  />
                </Field>
              )}
              {updateJob && (
                <p className="provider-update-status prov-note" role="status">{updateJob.status === 'running' && <LoaderCircle size={12} className="spin" />}{updateJob.status === 'error' ? 'Update/install failed: ' : updateJob.status === 'done' ? 'Finished: ' : `${updateJob.label}: `}{updateJob.message}</p>
              )}
            </div>
          </>
        )}

        {row.kind === 'local_server' && (
          <>
            <h5 className="prov-section">Connection</h5>
            <div className="prov-card">
              <Field title="Server" desc={row.detectedPort ? (row.baseUrl ?? `localhost:${row.detectedPort}`) : (LOCAL_SETUP[row.id] ?? `Start ${row.label} and load a model, then press Refresh.`)}>
                {row.canStart && !row.detectedPort
                  ? <button type="button" className="btn btn-small" disabled={starting !== null} onClick={() => void start(row)}>{starting === row.id ? <LoaderCircle size={12} className="spin" /> : <Play size={12} />} Start server</button>
                  : !row.usable && <button type="button" className="btn btn-small" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />} Check again</button>}
              </Field>
              <Field wide title="Address" desc={`Bhippi checks the usual port${row.id === 'lmstudio' ? ' and the port set in LM Studio' : ''} by itself. Only set one if ${row.label} runs on another port or computer.`}>
                {endpointForm(row)}
              </Field>
              {(needsKey(row) || row.keySource) && (
                <Field wide title="API key" desc={`Only if you set one in ${row.label}.`}>{keyForm(row)}</Field>
              )}
            </div>
          </>
        )}

        {row.kind === 'cloud_api' && (
          <>
            <h5 className="prov-section">Credentials</h5>
            <div className="prov-card">
              <Field wide title="API key" desc={row.keySource === 'env' ? `Read from ${row.keyEnv}. Paste one here to override it.` : row.keySource === 'keychain' ? 'Saved in the Windows Credential Manager, never in project files.' : 'Stored in the Windows Credential Manager, never in project files. Its models are read as soon as it is saved.'}>
                {keyForm(row)}
              </Field>
            </div>
          </>
        )}
      </section>
    );
  };

  return (
    <div className="prov">
      <div className="prov-top">
        <div>
          <h3>AI providers</h3>
          <p>{ready ? `${ready} provider${ready === 1 ? '' : 's'} ready.` : 'No AI provider is ready yet — the offline command parser still works.'} Pick a model from the model menu in the chat.</p>
        </div>
        <div className="prov-top-actions">
          {onUsage && <button type="button" className="btn btn-small" onClick={onUsage}><Activity size={13} /> Usage</button>}
          <button type="button" className="prov-checked" onClick={() => void refresh()} disabled={refreshing} title="Re-detect providers and re-read every model list">
            <RefreshCw size={12} className={refreshing ? 'spin' : undefined} />
            {refreshing ? 'Checking…' : `Checked ${checkedAgo(providers, now)}`}
          </button>
          <button type="button" className="icon-btn small" onClick={() => void updateAll()} disabled={refreshing || installing.size > 0 || updatingAll} title={updatable.length ? `Update ${updatable.map((row) => row.label).join(', ')}, then re-read every model list` : 'Re-read every model list (no installed provider needs Bhippi to update it)'} aria-label="Update all providers">
            {updatingAll ? <LoaderCircle size={13} className="spin" /> : <Download size={13} />}
          </button>
          {absent.length > 0 && (
            <button type="button" className={`icon-btn small${adding ? ' active' : ''}`} onClick={() => setAdding(!adding)} title={`Add a provider (${absent.length} more Bhippi can reach)`} aria-label="Add provider" aria-expanded={adding}>
              <Plus size={14} />
            </button>
          )}
        </div>
      </div>
      {allJob && <p className="provider-update-status provider-update-all-status" role="status">{updatingAll && <LoaderCircle size={12} className="spin" />}{allJob.status === 'error' ? 'Update all failed: ' : allJob.status === 'done' ? 'Update all finished: ' : ''}{allJob.message}</p>}

      <div className="prov-shell">
        <div className="prov-list" aria-label="Providers">
          <label className="prov-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search providers or models" aria-label="Search providers" /></label>
          {(['cli', 'cloud_api', 'local_server', 'builtin'] as const).map((kind) => {
            const rows = present.filter((row) => row.kind === kind && matches(row));
            return rows.length > 0 && <div key={kind} role="listbox" aria-label={kind === 'cli' ? 'CLI runtimes' : kind === 'cloud_api' ? 'Cloud APIs' : kind === 'local_server' ? 'Local servers' : 'Built in'}><div className="prov-group-title">{kind === 'cli' ? 'CLI runtimes' : kind === 'cloud_api' ? 'Cloud APIs' : kind === 'local_server' ? 'Local servers' : 'Built in'}</div>{rows.map((row) => listRow(row, true))}</div>;
          })}
          {!present.some(matches) && <p className="prov-list-empty">No matching connected providers.</p>}
          {absent.length > 0 && (
            <button type="button" className="prov-add" onClick={() => setAdding(!adding)} aria-expanded={adding}>
              <Plus size={12} /> {adding ? 'Hide' : 'Add provider'} <span className="muted">{absent.length}</span>
              <ChevronDown size={12} style={{ marginLeft: 'auto', transform: adding ? 'rotate(180deg)' : undefined }} />
            </button>
          )}
          {(adding || query.trim()) && <div role="listbox" aria-label="Available providers">{absent.filter(matches).map((row) => listRow(row, false))}</div>}
        </div>
        {shown ? detail(shown) : <section className="prov-detail"><p className="muted">No providers found. Press Refresh.</p></section>}
      </div>
    </div>
  );
}

/** "2.1.283 (Claude Code)" → "v2.1.283". */
function shortVersion(version: string) {
  const number = version.match(/\d+(?:\.\d+)+/)?.[0];
  return number ? `v${number}` : version;
}

/** The line under a provider's name in the list: its state, then what it holds. */
function statusLine(row: ProviderInfo, state: string) {
  if (row.kind !== 'builtin' && !row.enabled) return 'Hidden from chat';
  if (row.kind === 'builtin') return 'Ready · works offline';
  if (!row.usable) return state;
  return [state, row.models.length ? `${row.models.length} model${row.models.length === 1 ? '' : 's'}` : null, row.keySource === 'env' ? row.keyEnv : null].filter(Boolean).join(' · ');
}

/** What the Status row says: where the provider was found and anything wrong with it. */
function statusDetail(row: ProviderInfo, setUp: boolean) {
  if (row.kind === 'builtin') return 'Always available and offline: direct edit commands, no AI. Updates with Bhippi.';
  const parts: string[] = [];
  if (!setUp) parts.push(row.kind === 'cli' ? 'Not installed on this computer.' : row.kind === 'local_server' ? 'Not running on this computer.' : 'No API key saved yet.');
  if (row.detectedPort) parts.push(`Answering at localhost:${row.detectedPort}.`);
  if (row.keySource) parts.push(`Key from ${row.keySource === 'env' ? row.keyEnv : 'the Credential Manager'}.`);
  if (setUp && !row.usable && row.health.state !== 'healthy' && row.health.state !== 'disabled') parts.push(row.health.reason);
  if (row.usable && row.health.state === 'degraded') parts.push(row.health.reason);
  if (row.kind === 'cli' && setUp) parts.push('Runs per message in an empty workspace — it cannot touch your files.');
  return parts.join(' ') || 'Ready.';
}

/** "just now", "4 min ago", "2 h ago" — when the newest model list was read. */
function checkedAgo(providers: ProviderInfo[], now: number) {
  const newest = Math.max(0, ...providers.map((row) => Date.parse(row.detectedAt)).filter(Number.isFinite));
  if (!newest) return 'never';
  const seconds = Math.max(0, Math.round((now - newest) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}

/** One settings row: a bold title and a line of help on the left, its control on the right (or below, `wide`). */
function Field({ title, desc, wide, children }: { title: string; desc?: ReactNode; wide?: boolean; children?: ReactNode }) {
  return (
    <div className={`prov-field${wide ? ' wide' : ''}`}>
      <div className="prov-field-copy">
        <b>{title}</b>
        {desc && <p>{desc}</p>}
      </div>
      {children && <div className="prov-field-control">{children}</div>}
    </div>
  );
}
