import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Boxes, Brain, Check, Cloud, Code2, Cpu, Download, ExternalLink, Film, FolderOpen, Gem, KeyRound, LoaderCircle, Mic, Palette, RefreshCw, Scissors, ShieldCheck, Sparkles, Terminal, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { ProviderLogo } from '../components/ProviderLogo';
import { Modal, Toggle, useToast } from '../components/ui';
import { SpeechSettings } from './SpeechSettings';
import { BrainSettings } from './BrainSettings';
import { BrandKitSettings } from './BrandKitSettings';
import { LocalMediaSettings } from './LocalMediaSettings';
import { api, errorText } from '../lib/ipc';
import type { AppInfo, Asset, Job, ProviderInfo, ProviderKind, Settings, ToolStatus } from '../lib/types';

export type SettingsTab = 'providers' | 'speech' | 'local-media' | 'media' | 'appearance' | 'brain' | 'brand' | 'about';

type Props = {
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  onClose: () => void;
  providers: ProviderInfo[];
  onProviders: (rows: ProviderInfo[]) => void;
  info: AppInfo | null;
  onTools: (status: ToolStatus) => void;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  jobs: Job[];
  /** The open project's brand kit pointer and how to change it (Brand kit tab). */
  projectBrandKitId?: string | null;
  onProjectBrandKit?: (id: string | null) => void;
  /** Imports files into the project library (logos land in a "Brand" folder). */
  importMedia?: (paths: string[], folderId?: string | null) => Promise<Asset[]>;
};

const GROUPS: { kind: ProviderKind; title: string; icon: typeof Terminal; blurb: string }[] = [
  { kind: 'cli', title: 'Coding agents', icon: Terminal, blurb: 'CLIs you are already signed in to. Helios runs them per message in an empty workspace — they cannot touch your files.' },
  { kind: 'local_server', title: 'Local models', icon: Cpu, blurb: 'Model servers running on this computer. Private and free; start the app and press Refresh.' },
  { kind: 'cloud_api', title: 'Cloud APIs', icon: Cloud, blurb: 'Bring your own key. Keys are stored in the Windows Credential Manager, never in project files.' },
  { kind: 'builtin', title: 'Built in', icon: Sparkles, blurb: 'Always available, works offline.' },
];

function status(row: ProviderInfo, installing: boolean): { tone: 'ok' | 'warn' | 'off' | 'error'; label: string } {
  if (installing) return { tone: 'warn', label: 'Installing…' };
  if (row.kind === 'builtin') return { tone: 'ok', label: 'Ready' };
  if (row.usable) return row.health.state === 'degraded' ? { tone: 'warn', label: 'Ready · unverified' } : { tone: 'ok', label: 'Ready' };
  if (row.kind === 'cli') return { tone: 'off', label: 'Not installed' };
  if (row.kind === 'local_server') {
    if (row.detectedPort) return { tone: 'warn', label: 'No model loaded' };
    return row.offered ? { tone: 'warn', label: 'Not running' } : { tone: 'off', label: 'Not detected' };
  }
  if (row.health.state === 'unavailable') return { tone: 'error', label: 'Key rejected' };
  return { tone: 'off', label: 'Needs API key' };
}

export function SettingsModal(props: Props) {
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const installing = new Set(props.jobs.filter((job) => job.kind === 'install' && job.status === 'running').map((job) => job.label.replace(/^(Installing|Updating) /, '')));
  const ready = props.providers.filter((row) => row.usable && row.kind !== 'builtin').length;

  const refresh = async () => {
    setRefreshing(true);
    try {
      props.onProviders(await api.providersRefresh());
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
      props.onProviders(rows);
      setKeys((current) => ({ ...current, [row.id]: '' }));
      const updated = rows.find((item) => item.id === row.id);
      if (!value.trim()) toast({ tone: 'info', title: `${row.label} key removed` });
      else if (updated?.usable) toast({ tone: 'success', title: `${row.label} connected`, body: `${updated.models.length} models available` });
      else toast({ tone: 'error', title: `${row.label} key not accepted`, body: updated?.health.state === 'unavailable' ? updated.health.reason : 'Check the key and try again.' });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not save the key', body: errorText(error) });
    } finally {
      setSavingKey(null);
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
      props.onProviders(await api.providerSetEnabled(row.id, enabled));
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

  return (
    <Modal title="Settings" onClose={props.onClose} width={820}>
      <div className="settings">
        <nav className="settings-nav">
          <button type="button" className={props.tab === 'local-media' ? 'active' : ''} onClick={() => props.onTab('local-media')}><Film size={14} /> Local media</button>
          <button type="button" className={props.tab === 'providers' ? 'active' : ''} onClick={() => props.onTab('providers')}><Sparkles size={14} /> AI providers</button>
          <button type="button" className={props.tab === 'speech' ? 'active' : ''} onClick={() => props.onTab('speech')}><Mic size={14} /> Model Center</button>
          <button type="button" className={props.tab === 'media' ? 'active' : ''} onClick={() => props.onTab('media')}><FolderOpen size={14} /> Media &amp; FFmpeg</button>
          <button type="button" className={props.tab === 'appearance' ? 'active' : ''} onClick={() => props.onTab('appearance')}><Palette size={14} /> Appearance</button>
          <button type="button" className={props.tab === 'brain' ? 'active' : ''} onClick={() => props.onTab('brain')}><Brain size={14} /> Brain</button>
          <button type="button" className={props.tab === 'brand' ? 'active' : ''} onClick={() => props.onTab('brand')}><Gem size={14} /> Brand kit</button>
          <button type="button" className={props.tab === 'about' ? 'active' : ''} onClick={() => props.onTab('about')}><Cpu size={14} /> About</button>
        </nav>
        <div className="settings-body">
          {props.tab === 'brand' && <BrandKitSettings settings={props.settings} onSettings={props.onSettings} projectBrandKitId={props.projectBrandKitId ?? null} onProjectBrandKit={props.onProjectBrandKit ?? (() => undefined)} importMedia={props.importMedia} />}
          {props.tab === 'local-media' && <LocalMediaSettings settings={props.settings} onSettings={props.onSettings} />}
          {props.tab === 'providers' && (
            <>
              <div className="settings-intro">
                <div>
                  <h3>AI providers</h3>
                  <p>{ready ? `${ready} provider${ready === 1 ? '' : 's'} ready.` : 'No AI provider is ready yet — the offline command parser still works.'} Pick one from the model menu in the chat.</p>
                  <p>Auto-update runs daily while Helios is open and no AI request is running. Cloud services update on their servers.</p>
                </div>
                <button type="button" className="btn" onClick={() => void refresh()} disabled={refreshing}>
                  {refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
                </button>
              </div>
              {GROUPS.map((group) => {
                const rows = props.providers.filter((row) => row.kind === group.kind);
                if (!rows.length) return null;
                return (
                  <section key={group.kind} className="provider-group">
                    <h4><group.icon size={14} /> {group.title}</h4>
                    <p className="group-blurb">{group.blurb}</p>
                    {rows.map((row) => {
                      const state = status(row, installing.has(row.label));
                      const updateJob = props.jobs.filter(job => job.kind === 'install' && [ `Updating ${row.label}`, `Installing ${row.label}` ].includes(job.label)).at(-1);
                      return (
                        <div key={row.id} className={`provider-row${row.usable ? ' ready' : ''}`}>
                          <ProviderLogo id={row.id} size={28} />
                          <div className="provider-main">
                            <div className="provider-title">
                              <strong>{row.label}</strong>
                              <span className={`pill tone-${state.tone}`}>{state.tone === 'ok' ? <Check size={11} /> : state.tone === 'error' ? <TriangleAlert size={11} /> : null}{state.label}</span>
                            </div>
                            {row.kind === 'cli' && row.installed && row.installCommand && <label className="provider-auto-update"><input type="checkbox" checked={(props.settings.autoUpdateProviders ?? []).includes(row.id)} onChange={event => props.onSettings({ ...props.settings, autoUpdateProviders: event.target.checked ? [...new Set([...(props.settings.autoUpdateProviders ?? []), row.id])] : (props.settings.autoUpdateProviders ?? []).filter(id => id !== row.id) })} /> Auto-update daily when idle</label>}
                            {updateJob && <p className="provider-update-status" role="status">{updateJob.status === 'running' && <LoaderCircle size={12} className="spin" />}{updateJob.status === 'error' ? 'Update/install failed: ' : updateJob.status === 'done' ? 'Finished: ' : `${updateJob.label}: `}{updateJob.message}</p>}
                            <div className="provider-detail">
                              {row.version && <span>{row.version}</span>}
                              {row.detectedPort && <span>localhost:{row.detectedPort}</span>}
                              {row.usable && row.models.length > 0 && row.kind !== 'builtin' && <span>{row.models.length} model{row.models.length === 1 ? '' : 's'}</span>}
                              {row.keySource && <span>key from {row.keySource === 'env' ? row.keyEnv : 'Credential Manager'}</span>}
                              {!row.usable && row.health.state !== 'healthy' && row.health.state !== 'disabled' && row.kind !== 'cli' && <span className="muted">{row.health.reason}</span>}
                              {!row.usable && row.kind === 'cli' && row.installCommand && <code>{row.installCommand}</code>}
                            </div>
                            {row.kind === 'cloud_api' && (
                              <form className="key-form" onSubmit={(event) => { event.preventDefault(); void saveKey(row, keys[row.id] ?? ''); }}>
                                <KeyRound size={13} />
                                <input type="password" placeholder={row.keySource === 'keychain' ? 'Key saved — paste a new one to replace' : row.keySource === 'env' ? `Using ${row.keyEnv} — paste to override` : `Paste ${row.label} key`} value={keys[row.id] ?? ''} onChange={(event) => { const value = event.target.value; setKeys((current) => ({ ...current, [row.id]: value })); }} autoComplete="off" spellCheck={false} />
                                <button type="submit" className="btn btn-small" disabled={savingKey === row.id || !(keys[row.id] ?? '').trim()}>{savingKey === row.id ? <LoaderCircle size={12} className="spin" /> : 'Save'}</button>
                                {row.keySource === 'keychain' && <button type="button" className="btn btn-small btn-ghost" onClick={() => void saveKey(row, '')}>Remove</button>}
                              </form>
                            )}
                          </div>
                          <div className="provider-actions">
                            {row.kind === 'cli' && row.installed && row.installCommand && <button type="button" className="btn btn-small" disabled={installing.size > 0} onClick={() => void update(row)}>{installing.has(row.label) ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />} Update</button>}
                            {row.kind === 'cloud_api' && <button type="button" className="btn btn-small" disabled={refreshing} onClick={() => void refresh()} title="Cloud software updates automatically; refresh available models">Refresh models</button>}
                            {((row.kind === 'cli' && row.installed && !row.installCommand) || row.kind === 'local_server') && row.homepage && <button type="button" className="btn btn-small" onClick={() => void api.openUrl(row.homepage!)}>Update in provider app</button>}
                            {row.kind === 'builtin' && <span className="muted">Updates with Helios</span>}
                            {row.kind === 'cli' && !row.usable && row.installCommand && (
                              <button type="button" className="btn btn-small" onClick={() => void install(row)} disabled={installing.has(row.label)}><Download size={12} /> Install</button>
                            )}
                            {row.homepage && (
                              <button type="button" className="icon-btn small" onClick={() => void api.openUrl(row.homepage!)} title={row.kind === 'cloud_api' ? 'Get an API key' : 'Website'}><ExternalLink size={13} /></button>
                            )}
                            {row.kind !== 'builtin' && <Toggle checked={row.enabled} onChange={(enabled) => void setEnabled(row, enabled)} label={`Show ${row.label} in the chat`} />}
                          </div>
                        </div>
                      );
                    })}
                  </section>
                );
              })}
            </>
          )}
          {props.tab === 'speech' && <SpeechSettings settings={props.settings} onSettings={props.onSettings} jobs={props.jobs} />}
          {props.tab === 'media' && <MediaSettings {...props} />}
          {props.tab === 'appearance' && (
            <div className="appearance-settings">
              <div className="settings-intro">
                <div>
                  <h3>Appearance</h3>
                  <p>Surface only — the theme changes how Helios looks, never what it does.</p>
                </div>
              </div>
              <div className="theme-pick" role="radiogroup" aria-label="Color theme">
                {([
                  { id: 'default', name: 'Default', detail: 'The pro NLE workspace: neutral greys, hairline seams, one blue for focus.' },
                  { id: 'minimal', name: 'Minimalist', detail: 'Flatter surfaces, quieter seams, calmer chrome — same layout, less noise.' },
                ] as const).map((theme) => (
                  <label key={theme.id} className={`theme-card${(props.settings.theme ?? 'default') === theme.id ? ' selected' : ''}`}>
                    <input type="radio" name="theme" checked={(props.settings.theme ?? 'default') === theme.id} onChange={() => props.onSettings({ ...props.settings, theme: theme.id })} />
                    <span className="theme-copy"><span className="theme-name">{theme.name}</span><span className="theme-detail">{theme.detail}</span></span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {props.tab === 'brain' && <BrainSettings settings={props.settings} onSettings={props.onSettings} />}
          {props.tab === 'about' && (
            <div className="about">
              <div className="about-head">
                <img src="/helios.svg" alt="" width={52} height={52} />
                <div>
                  <h3>Helios <span className="about-version">{props.info?.version}</span></h3>
                  <p className="about-by">Made by Aayush Datta</p>
                </div>
              </div>

              <p className="about-lead">
                A video and motion studio that runs on your own computer. Your footage never leaves it — the only thing
                that ever goes out is a short summary of the timeline, and only when you send a message to a cloud AI
                provider. Nothing is uploaded to render, transcribe or separate a subject.
              </p>

              <h4 className="about-section">What it is built on</h4>
              <div className="about-grid">
                {[
                  { icon: <Cpu size={14} />, name: 'Rust and Tauri', detail: 'The app itself: the window, the project files, the render queue and every command the interface calls.' },
                  { icon: <Code2 size={14} />, name: 'React and TypeScript', detail: 'The editor — timeline, monitors, panels — with the editing engine written as pure functions so it can be tested.' },
                  { icon: <Film size={14} />, name: 'FFmpeg', detail: 'Decoding, thumbnails, waveforms, scene detection and every frame of the export.' },
                  { icon: <Scissors size={14} />, name: 'Robust Video Matting', detail: 'Separating a person from their background, frame by frame, on this machine.' },
                  { icon: <Mic size={14} />, name: 'Whisper', detail: 'Speech to timed words for captions — offline through whisper.cpp, or on a key you already have.' },
                  { icon: <Sparkles size={14} />, name: 'WatchFIWN caption styles', detail: 'The caption library: eighty styles, rendered the same in the preview and in the export.' },
                  { icon: <Boxes size={14} />, name: 'MCP', detail: 'Helios serves its own tools to CLI agents, and connects out to other people\u2019s servers.' },
                  { icon: <ShieldCheck size={14} />, name: 'Your own keys', detail: 'Provider keys live in this computer\u2019s credential store, never in the project file.' },
                ].map((item) => (
                  <div key={item.name} className="about-item">
                    <span className="about-icon">{item.icon}</span>
                    <span className="about-copy">
                      <span className="about-name">{item.name}</span>
                      <span className="about-detail">{item.detail}</span>
                    </span>
                  </div>
                ))}
              </div>

              <p className="muted about-credit">
                AI provider orchestration — the catalogue, detection, CLI streaming and fault advice — is adapted from
                Bhippi. Caption styles come from WatchFIWN.
              </p>

              <div className="shortcuts">
                <h4>Shortcuts</h4>
                {[
                  ['Space', 'Play / pause'], ['\u2190 \u2192', 'Step one frame (Shift: one second)'], ['S', 'Split at playhead'], ['Del', 'Delete selection'],
                  ['Ctrl+D', 'Duplicate selection'], ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['Ctrl+I', 'Import media'], ['Ctrl+E', 'Export'],
                  ['Ctrl+L', 'Toggle Helios AI'], ['Ctrl + wheel', 'Zoom timeline'],
                ].map(([keys, action]) => (
                  <div key={keys} className="shortcut"><kbd>{keys}</kbd><span>{action}</span></div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function MediaSettings({ info, onTools, settings, onSettings }: Props) {
  const toast = useToast();
  const [path, setPath] = useState(settings.ffmpegPath ?? '');
  const [busy, setBusy] = useState(false);
  const ffmpeg = info?.ffmpeg;

  const apply = async (value: string | null) => {
    setBusy(true);
    try {
      const saved = await api.settingsSave({ ...settings, ffmpegPath: value });
      onSettings(saved);
      const status = await api.ffmpegRefresh();
      onTools(status);
      toast(status.found ? { tone: 'success', title: 'FFmpeg found', body: status.version ?? status.path ?? '' } : { tone: 'error', title: 'FFmpeg still not found', body: 'Point to the folder that contains ffmpeg.exe and ffprobe.exe.' });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not update FFmpeg', body: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="media-settings">
      <h3>FFmpeg</h3>
      <p>Helios uses FFmpeg to read media, build previews, and export. It is found automatically on PATH and in WinGet, Scoop, and Chocolatey installs.</p>
      <div className={`tool-card${ffmpeg?.found ? ' ok' : ' missing'}`}>
        {ffmpeg?.found ? <Check size={18} /> : <TriangleAlert size={18} />}
        <div>
          <strong>{ffmpeg?.found ? `FFmpeg ${ffmpeg.version ?? ''}` : 'FFmpeg not found'}</strong>
          <span>{ffmpeg?.found ? ffmpeg.path : 'Install it with: winget install Gyan.FFmpeg — then press Detect again.'}</span>
          {ffmpeg?.found && !ffmpeg.x264 && <span className="warn">This build has no libx264; exports use a slower fallback encoder.</span>}
        </div>
      </div>
      <label className="field">
        <span>Custom FFmpeg location (optional)</span>
        <div className="field-inline">
          <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="C:\ffmpeg\bin" spellCheck={false} />
          <button type="button" className="btn" onClick={async () => { const picked = await openDialog({ directory: true, title: 'Folder containing ffmpeg.exe' }); if (typeof picked === 'string') setPath(picked); }}><FolderOpen size={14} /> Browse</button>
          <button type="button" className="btn btn-primary" onClick={() => void apply(path.trim() || null)} disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Detect</button>
        </div>
      </label>
      <h3>Library</h3>
      <p>Imported files are referenced where they are — nothing is copied. Thumbnails, waveforms, previews and your project live in the Helios data folder.</p>
      <div className="field-inline">
        <code className="path">{info?.dataDir}</code>
        <button type="button" className="btn" onClick={() => info && void api.openPath(info.dataDir)}><FolderOpen size={14} /> Open</button>
      </div>
      <p className="muted small">Supported: {info?.extensions.join(', ')}</p>
    </div>
  );
}
