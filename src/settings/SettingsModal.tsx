import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Boxes, Brain, Check, Code2, Cpu, Film, FolderOpen, Gem, HardDrive, LoaderCircle, Mic, Palette, RefreshCw, Scissors, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Modal, useToast } from '../components/ui';
import { SpeechSettings } from './SpeechSettings';
import { BrainSettings } from './BrainSettings';
import { BrandKitSettings } from './BrandKitSettings';
import { LocalMediaSettings } from './LocalMediaSettings';
import { StorageSettings } from './StorageSettings';
import { ProvidersSettings } from './ProvidersSettings';
import { ProfileSection } from './ProfileSection';
import { UpdateSection } from './UpdateSection';
import { api, errorText } from '../lib/ipc';
import type { AppInfo, Asset, Job, ProviderInfo, Settings, ToolStatus } from '../lib/types';
import '../styles/about.css';

export type SettingsTab = 'providers' | 'speech' | 'local-media' | 'media' | 'storage' | 'appearance' | 'brain' | 'brand' | 'about';

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

// Settings › About: what Helios is built on, and the keyboard shortcuts it lists.
const BUILT_ON = [
  { icon: <Cpu size={14} />, name: 'Rust and Tauri', detail: 'The app itself: the window, the project files, the render queue and every command the interface calls.' },
  { icon: <Code2 size={14} />, name: 'React and TypeScript', detail: 'The editor — timeline, monitors, panels — with the editing engine written as pure functions so it can be tested.' },
  { icon: <Film size={14} />, name: 'FFmpeg', detail: 'Decoding, thumbnails, waveforms, scene detection and every frame of the export.' },
  { icon: <Scissors size={14} />, name: 'Robust Video Matting', detail: 'Separating a person from their background, frame by frame, on this machine.' },
  { icon: <Mic size={14} />, name: 'Whisper', detail: 'Speech to timed words for captions — offline through whisper.cpp, or on a key you already have.' },
  { icon: <Sparkles size={14} />, name: 'WatchFIWN caption styles', detail: 'The caption library: eighty styles, rendered the same in the preview and in the export.' },
  { icon: <Boxes size={14} />, name: 'MCP', detail: 'Helios serves its own tools to CLI agents, and connects out to other people’s servers.' },
  { icon: <ShieldCheck size={14} />, name: 'Your own keys', detail: 'Provider keys live in this computer’s credential store, never in the project file.' },
];

const SHORTCUTS: [keys: string, action: string][] = [
  ['Space', 'Play / pause'], ['← →', 'Step one frame (Shift: one second)'], ['S', 'Split at playhead'], ['Del', 'Delete selection'],
  ['Ctrl+D', 'Duplicate selection'], ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['Ctrl+I', 'Import media'], ['Ctrl+E', 'Export'],
  ['Ctrl+L', 'Toggle Helios AI'], ['Ctrl + wheel', 'Zoom timeline'],
];

/** Two top-to-bottom halves, so the list reads down each column rather than across. */
const SHORTCUT_COLUMNS = [SHORTCUTS.slice(0, Math.ceil(SHORTCUTS.length / 2)), SHORTCUTS.slice(Math.ceil(SHORTCUTS.length / 2))];

export function SettingsModal(props: Props) {
  return (
    <Modal title="Settings" onClose={props.onClose} width="min(1320px, calc(100vw - 48px))" className="settings-modal">
      <div className="settings">
        <nav className="settings-nav">
          <button type="button" className={props.tab === 'local-media' ? 'active' : ''} onClick={() => props.onTab('local-media')}><Film size={14} /> Local media</button>
          <button type="button" className={props.tab === 'providers' ? 'active' : ''} onClick={() => props.onTab('providers')}><Sparkles size={14} /> AI providers</button>
          <button type="button" className={props.tab === 'speech' ? 'active' : ''} onClick={() => props.onTab('speech')}><Mic size={14} /> Model Center</button>
          <button type="button" className={props.tab === 'media' ? 'active' : ''} onClick={() => props.onTab('media')}><FolderOpen size={14} /> Media &amp; FFmpeg</button>
          <button type="button" className={props.tab === 'storage' ? 'active' : ''} onClick={() => props.onTab('storage')}><HardDrive size={14} /> Storage</button>
          <button type="button" className={props.tab === 'appearance' ? 'active' : ''} onClick={() => props.onTab('appearance')}><Palette size={14} /> Appearance</button>
          <button type="button" className={props.tab === 'brain' ? 'active' : ''} onClick={() => props.onTab('brain')}><Brain size={14} /> Brain</button>
          <button type="button" className={props.tab === 'brand' ? 'active' : ''} onClick={() => props.onTab('brand')}><Gem size={14} /> Brand kit</button>
          <button type="button" className={props.tab === 'about' ? 'active' : ''} onClick={() => props.onTab('about')}><Cpu size={14} /> About</button>
        </nav>
        <div className="settings-body">
          {props.tab === 'brand' && <BrandKitSettings settings={props.settings} onSettings={props.onSettings} projectBrandKitId={props.projectBrandKitId ?? null} onProjectBrandKit={props.onProjectBrandKit ?? (() => undefined)} importMedia={props.importMedia} />}
          {props.tab === 'local-media' && <LocalMediaSettings settings={props.settings} onSettings={props.onSettings} />}
          {props.tab === 'providers' && <ProvidersSettings providers={props.providers} onProviders={props.onProviders} settings={props.settings} onSettings={props.onSettings} jobs={props.jobs} />}
          {props.tab === 'speech' && <SpeechSettings settings={props.settings} onSettings={props.onSettings} jobs={props.jobs} />}
          {props.tab === 'media' && <MediaSettings {...props} />}
          {props.tab === 'storage' && <StorageSettings settings={props.settings} onSettings={props.onSettings} />}
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
            // Layout lives in styles/about.css: one container-query grid, so every block shares the
            // same left/right edges and the same midline, and collapses by the panel's own width.
            <div className="about-v2">
              <header className="about-hero">
                <img className="about-logo" src="/helios.svg" alt="" width={56} height={56} />
                <div className="about-ident">
                  <h3 className="about-title">
                    Helios
                    {props.info?.version && <span className="about-pill">v{props.info.version}</span>}
                  </h3>
                  <p className="about-maker">Made by Aayush Datta</p>
                </div>
                <p className="about-intro">
                  A video and motion studio that runs on your own computer. Your footage never leaves it — the only thing
                  that ever goes out is a short summary of the timeline, and only when you send a message to a cloud AI
                  provider. Nothing is uploaded to render, transcribe or separate a subject.
                </p>
              </header>

              <div className="about-pair">
                <section className="about-block">
                  <h4 className="about-heading">Updates</h4>
                  <UpdateSection version={props.info?.version} settings={props.settings} onSettings={props.onSettings} />
                </section>
                <section className="about-block">
                  <h4 className="about-heading">Profile</h4>
                  <ProfileSection />
                </section>
              </div>

              <section className="about-block">
                <h4 className="about-heading">What it is built on</h4>
                <ul className="about-stack">
                  {BUILT_ON.map((item) => (
                    <li key={item.name} className="about-tile">
                      <span className="about-tile-icon">{item.icon}</span>
                      <span className="about-tile-name">{item.name}</span>
                      <span className="about-tile-text">{item.detail}</span>
                    </li>
                  ))}
                </ul>
                <p className="about-credits">
                  AI provider orchestration — the catalogue, detection, CLI streaming and fault advice — is adapted from
                  Bhippi. Caption styles come from WatchFIWN.
                </p>
              </section>

              <section className="about-block">
                <h4 className="about-heading">Keyboard shortcuts</h4>
                <div className="about-keys">
                  {SHORTCUT_COLUMNS.map((column) => (
                    <dl key={column[0][0]} className="about-keylist">
                      {column.map(([keys, action]) => (
                        <div key={keys} className="about-key">
                          <dt><kbd>{keys}</kbd></dt>
                          <dd>{action}</dd>
                        </div>
                      ))}
                    </dl>
                  ))}
                </div>
              </section>
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
          {ffmpeg?.found && <span>{ffmpeg.gpuEncoderLabel ? `GPU export encoder: ${ffmpeg.gpuEncoderLabel} (${ffmpeg.gpuEncoder})` : 'No working GPU export encoder — exports encode on the CPU.'}</span>}
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
      <p>Imported files are referenced where they are unless Storage › Copy imported media is on. Thumbnails, waveforms, previews and settings live in the Helios data folder; each project's own files live in its project folder (see Storage).</p>
      <div className="field-inline">
        <code className="path">{info?.dataDir}</code>
        <button type="button" className="btn" onClick={() => info && void api.openPath(info.dataDir)}><FolderOpen size={14} /> Open</button>
      </div>
      <p className="muted small">Supported: {info?.extensions.join(', ')}</p>
    </div>
  );
}
