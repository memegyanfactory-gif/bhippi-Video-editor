// Settings › AI providers.
//
// Only what this computer actually has is listed: a CLI on PATH, a model server that answered,
// an API key that is saved. Everything else Bhippi knows how to reach waits behind "Add
// provider", one click away, instead of a wall of "not running" and "needs an API key" rows.
import { Check, ChevronDown, Cloud, Cpu, Download, ExternalLink, KeyRound, Link2, LoaderCircle, Play, Plus, RefreshCw, Sparkles, Terminal, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { ProviderLogo } from '../components/ProviderLogo';
import { Toggle, useToast } from '../components/ui';
import { api, errorText } from '../lib/ipc';
import { pickerEntries } from '../lib/modelTiers';
import type { Job, ProviderInfo, ProviderKind, Settings } from '../lib/types';
import '../styles/models.css';

const GROUPS: { kind: ProviderKind; title: string; icon: typeof Terminal; blurb: string }[] = [
  { kind: 'cli', title: 'Coding agents', icon: Terminal, blurb: 'CLIs you are already signed in to. Bhippi runs them per message in an empty workspace — they cannot touch your files.' },
  { kind: 'local_server', title: 'Local models', icon: Cpu, blurb: 'Model servers running on this computer. Private and free.' },
  { kind: 'cloud_api', title: 'Cloud APIs', icon: Cloud, blurb: 'Your own keys, stored in the Windows Credential Manager, never in project files.' },
  { kind: 'builtin', title: 'Built in', icon: Sparkles, blurb: 'Always available, works offline.' },
];

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

export function ProvidersSettings({ providers, onProviders, settings, onSettings, jobs }: {
  providers: ProviderInfo[];
  onProviders: (rows: ProviderInfo[]) => void;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  jobs: Job[];
}) {
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addOpen, setAddOpen] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [endpoints, setEndpoints] = useState<Record<string, string>>(() => ({ ...(settings.localEndpoints ?? {}) }));
  const [savingEndpoint, setSavingEndpoint] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState<string | null>(null);
  const installing = new Set(jobs.filter((job) => job.kind === 'install' && job.status === 'running').map((job) => job.label.replace(/^(Installing|Updating) /, '')));
  const ready = providers.filter((row) => row.usable && row.kind !== 'builtin').length;
  const present = providers.filter(isSetUp);
  const absent = providers.filter((row) => !isSetUp(row));

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
        setAddOpen(null);
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

  /** Address + optional key for a local server, folded away unless it is needed. */
  const connection = (row: ProviderInfo) => {
    const open = connectOpen === row.id || needsKey(row) || Boolean(settings.localEndpoints?.[row.id]);
    if (!open) return <button type="button" className="btn btn-small btn-ghost provider-connection-toggle" onClick={() => setConnectOpen(row.id)}>Running on a different port or computer?</button>;
    return (
      <div className="provider-connection">
        {endpointForm(row)}
        {(needsKey(row) || row.keySource) && keyForm(row)}
        <p className="muted">Bhippi checks the usual port{row.id === 'lmstudio' ? ' and the port set in LM Studio' : ''} by itself. Only set an address if {row.label} runs on another port or another computer.</p>
      </div>
    );
  };

  const opened = absent.find((row) => row.id === addOpen);

  return (
    <>
      <div className="settings-intro">
        <div>
          <h3>AI providers</h3>
          <p>{ready ? `${ready} provider${ready === 1 ? '' : 's'} ready.` : 'No AI provider is ready yet — the offline command parser still works.'} Models are read from each provider automatically; pick one from the model menu in the chat.</p>
        </div>
        <div className="provider-intro-actions">
          <button type="button" className="btn btn-primary" onClick={() => void updateAll()} disabled={refreshing || installing.size > 0 || updatingAll} title={updatable.length ? `Update ${updatable.map((row) => row.label).join(', ')}, then re-read every model list` : 'Re-read every model list (no installed provider needs Bhippi to update it)'}>
            {updatingAll ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />} Update all
          </button>
          <button type="button" className="btn" onClick={() => void refresh()} disabled={refreshing} title="Re-detect providers and re-read every model list">
            {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
          </button>
        </div>
      </div>
      {allJob && <p className="provider-update-status provider-update-all-status" role="status">{updatingAll && <LoaderCircle size={12} className="spin" />}{allJob.status === 'error' ? 'Update all failed: ' : allJob.status === 'done' ? 'Update all finished: ' : ''}{allJob.message}</p>}
      {GROUPS.map((group) => {
        const rows = present.filter((row) => row.kind === group.kind);
        if (!rows.length) return null;
        return (
          <section key={group.kind} className="provider-group">
            <h4><group.icon size={14} /> {group.title}</h4>
            <p className="group-blurb">{group.blurb}</p>
            {rows.map((row) => {
              const state = status(row, installing.has(row.label));
              const updateJob = jobs.filter(job => job.kind === 'install' && [ `Updating ${row.label}`, `Installing ${row.label}` ].includes(job.label)).at(-1);
              return (
                <div key={row.id} className={`provider-row${row.usable ? ' ready' : ''}`}>
                  <ProviderLogo id={row.id} size={28} />
                  <div className="provider-main">
                    <div className="provider-title">
                      <strong>{row.label}</strong>
                      <span className={`pill tone-${state.tone}`}>{state.tone === 'ok' ? <Check size={11} /> : state.tone === 'error' ? <TriangleAlert size={11} /> : null}{state.label}</span>
                    </div>
                    {row.kind === 'cli' && row.installed && row.installCommand && <label className="provider-auto-update"><input type="checkbox" checked={(settings.autoUpdateProviders ?? []).includes(row.id)} onChange={event => onSettings({ ...settings, autoUpdateProviders: event.target.checked ? [...new Set([...(settings.autoUpdateProviders ?? []), row.id])] : (settings.autoUpdateProviders ?? []).filter(id => id !== row.id) })} /> Auto-update daily when idle</label>}
                    {updateJob && <p className="provider-update-status" role="status">{updateJob.status === 'running' && <LoaderCircle size={12} className="spin" />}{updateJob.status === 'error' ? 'Update/install failed: ' : updateJob.status === 'done' ? 'Finished: ' : `${updateJob.label}: `}{updateJob.message}</p>}
                    <div className="provider-detail">
                      {row.version && <span>{row.version}</span>}
                      {row.detectedPort && <span>localhost:{row.detectedPort}</span>}
                      {row.usable && row.models.length > 0 && row.kind !== 'builtin' && <span>{row.models.length} model{row.models.length === 1 ? '' : 's'}</span>}
                      {row.keySource && <span>key from {row.keySource === 'env' ? row.keyEnv : 'Credential Manager'}</span>}
                      {!row.usable && row.health.state !== 'healthy' && row.health.state !== 'disabled' && <span className="muted">{row.health.reason}</span>}
                    </div>
                    {row.usable && row.models.length > 0 && row.kind !== 'builtin' && <div className="provider-models-line" title={row.models.join('\n')}>{modelsLine(row)}</div>}
                    {row.kind === 'cloud_api' && keyForm(row)}
                    {row.kind === 'local_server' && !row.usable && connection(row)}
                  </div>
                  <div className="provider-actions">
                    {row.kind === 'local_server' && row.canStart && !row.detectedPort && <button type="button" className="btn btn-small" disabled={starting !== null} onClick={() => void start(row)}>{starting === row.id ? <LoaderCircle size={12} className="spin" /> : <Play size={12} />} Start server</button>}
                    {row.kind === 'local_server' && !row.usable && !row.canStart && <button type="button" className="btn btn-small" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />} Check again</button>}
                    {row.kind === 'cli' && row.installed && row.installCommand && <button type="button" className="btn btn-small" disabled={installing.size > 0} onClick={() => void update(row)}>{installing.has(row.label) ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />} Update</button>}
                    {row.kind === 'cloud_api' && <button type="button" className="btn btn-small" disabled={refreshing} onClick={() => void refresh()} title="Re-read this key's model list">Refresh models</button>}
                    {((row.kind === 'cli' && row.installed && !row.installCommand) || row.kind === 'local_server') && row.homepage && <button type="button" className="btn btn-small" onClick={() => void api.openUrl(row.homepage!)}>Open app site</button>}
                    {row.kind === 'builtin' && <span className="muted">Updates with Bhippi</span>}
                    {row.homepage && (
                      <button type="button" className="icon-btn small" onClick={() => void api.openUrl(row.homepage!)} title={row.kind === 'cloud_api' ? 'Manage keys' : 'Website'}><ExternalLink size={13} /></button>
                    )}
                    {row.kind !== 'builtin' && <Toggle checked={row.enabled} onChange={(enabled) => void setEnabled(row, enabled)} label={`Show ${row.label} in the chat`} />}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}

      {absent.length > 0 && (
        <section className="provider-add">
          <button type="button" className="btn provider-add-toggle" onClick={() => { setAdding(!adding); setAddOpen(null); }} aria-expanded={adding}>
            <Plus size={13} /> Add provider <span className="muted">({absent.length})</span> <ChevronDown size={12} style={{ transform: adding ? 'rotate(180deg)' : undefined }} />
          </button>
          {adding && (
            <>
              <div className="provider-add-list" role="list">
                {absent.map((row) => (
                  <button key={row.id} type="button" role="listitem" className={`provider-add-item${addOpen === row.id ? ' open' : ''}`} onClick={() => setAddOpen(addOpen === row.id ? null : row.id)}>
                    <ProviderLogo id={row.id} size={18} />
                    <span><strong>{row.label}</strong><small>{addHint(row)}</small></span>
                  </button>
                ))}
              </div>
              {opened && (
                <div className="provider-row provider-add-detail">
                  <ProviderLogo id={opened.id} size={28} />
                  <div className="provider-main">
                    <div className="provider-title"><strong>{opened.label}</strong></div>
                    {opened.kind === 'cloud_api' && <>{keyForm(opened)}<p className="muted">Its models are read from the API as soon as the key is saved.</p></>}
                    {opened.kind === 'cli' && <div className="provider-detail">{opened.installCommand ? <code>{opened.installCommand}</code> : <span>Install it from its website, then press Refresh.</span>}</div>}
                    {opened.kind === 'local_server' && <><p className="muted">{LOCAL_SETUP[opened.id] ?? `Start ${opened.label} and load a model, then press Refresh.`}</p>{endpointForm(opened)}</>}
                  </div>
                  <div className="provider-actions">
                    {opened.kind === 'cli' && opened.installCommand && (
                      <button type="button" className="btn btn-small" onClick={() => void install(opened)} disabled={installing.has(opened.label)}><Download size={12} /> Install</button>
                    )}
                    {opened.kind === 'local_server' && <button type="button" className="btn btn-small" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={12} /> Refresh</button>}
                    {opened.homepage && (
                      <button type="button" className="btn btn-small" onClick={() => void api.openUrl(opened.homepage!)}><ExternalLink size={12} /> {opened.kind === 'cloud_api' ? 'Get a key' : 'Website'}</button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
