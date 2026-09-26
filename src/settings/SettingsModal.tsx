import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Boxes, Brain, LifeBuoy, Lock, Check, Code2, Cpu, Film, FolderOpen, Gem, HardDrive, Info, LoaderCircle, Mic, Palette, PlugZap, RefreshCw, Scissors, Settings2, ShieldCheck, Smile, Sparkles, TriangleAlert, Wand2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Modal, useToast } from '../components/ui';
import { SpeechSettings } from './SpeechSettings';
import { BrainSettings } from './BrainSettings';
import { BrandKitSettings } from './BrandKitSettings';
import { LocalMediaSettings } from './LocalMediaSettings';
import { ConnectorsSettings } from './ConnectorsSettings';
import { StorageSettings } from './StorageSettings';
import { ProvidersSettings } from './ProvidersSettings';
import { ProfileSection } from './ProfileSection';
import { UpdateSection } from './UpdateSection';
import { AvatarSettings } from './AvatarSettings';
import { AppearanceSettings } from './AppearanceSettings';
import { GeneralSettings } from './GeneralSettings';
import { PrivacySettings } from './PrivacySettings';
import { SupportSettings } from './SupportSettings';
import { Row, Section, SettingsHeader } from './SettingsLayout';
import { api, errorText } from '../lib/ipc';
import type { AppInfo, Asset, Job, ProviderInfo, Settings, ToolStatus } from '../lib/types';
import '../styles/about.css';
import '../styles/settings.css';

export type SettingsTab = 'general' | 'providers' | 'connectors' | 'speech' | 'local-media' | 'media' | 'storage' | 'appearance' | 'avatar' | 'brain' | 'brand' | 'privacy' | 'support' | 'about';

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
  /** Closes Settings and runs the welcome tour. */
  onTour?: () => void;
};

// Settings › About: what Bhippi is built on, and the keyboard shortcuts it lists.
const BUILT_ON = [
  { icon: <Cpu size={14} />, name: 'Rust and Tauri', detail: 'The app itself: the window, the project files, the render queue and every command the interface calls.' },
  { icon: <Code2 size={14} />, name: 'React and TypeScript', detail: 'The editor — timeline, monitors, panels — with the editing engine written as pure functions so it can be tested.' },
  { icon: <Film size={14} />, name: 'FFmpeg', detail: 'Decoding, thumbnails, waveforms, scene detection and every frame of the export.' },
  { icon: <Scissors size={14} />, name: 'Robust Video Matting', detail: 'Separating a person from their background, frame by frame, on this machine.' },
  { icon: <Mic size={14} />, name: 'Whisper', detail: 'Speech to timed words for captions — offline through whisper.cpp, or on a key you already have.' },
  { icon: <Sparkles size={14} />, name: 'WatchFIWN caption styles', detail: 'The caption library: eighty styles, rendered the same in the preview and in the export.' },
  { icon: <Boxes size={14} />, name: 'MCP', detail: 'Bhippi serves its own tools to CLI agents, and connects out to other people’s servers.' },
  { icon: <ShieldCheck size={14} />, name: 'Your own keys', detail: 'Provider keys live in this computer’s credential store, never in the project file.' },
];

const SHORTCUTS: [keys: string, action: string][] = [
  ['Space', 'Play / pause'], ['← →', 'Step one frame (Shift: one second)'], ['S', 'Split at playhead'], ['Del', 'Delete selection'],
  ['Ctrl+D', 'Duplicate selection'], ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['Ctrl+I', 'Import media'], ['Ctrl+E', 'Export'],
  ['Ctrl+L', 'Toggle Bhippi AI'], ['Ctrl + wheel', 'Zoom timeline'],
];

/** Two top-to-bottom halves, so the list reads down each column rather than across. */
const SHORTCUT_COLUMNS = [SHORTCUTS.slice(0, Math.ceil(SHORTCUTS.length / 2)), SHORTCUTS.slice(Math.ceil(SHORTCUTS.length / 2))];

/** The sidebar: General on top, then the pages grouped by what they are about, About last. */
const NAV: { title?: string; items: { id: SettingsTab; label: string; icon: ReactNode }[] }[] = [
  { items: [{ id: 'general', label: 'General', icon: <Settings2 size={15} /> }] },
  { title: 'Look and feel', items: [
    { id: 'appearance', label: 'Appearance', icon: <Palette size={15} /> },
    { id: 'avatar', label: 'Avatar', icon: <Smile size={15} /> },
  ] },
  { title: 'AI', items: [
    { id: 'providers', label: 'AI providers', icon: <Sparkles size={15} /> },
    { id: 'speech', label: 'Model Center', icon: <Mic size={15} /> },
    { id: 'connectors', label: 'Connectors', icon: <PlugZap size={15} /> },
    { id: 'local-media', label: 'Local generation', icon: <Wand2 size={15} /> },
    { id: 'brain', label: 'Brain', icon: <Brain size={15} /> },
  ] },
  { title: 'Projects and media', items: [
    { id: 'brand', label: 'Brand kit', icon: <Gem size={15} /> },
    { id: 'storage', label: 'Storage', icon: <HardDrive size={15} /> },
    { id: 'media', label: 'Media & FFmpeg', icon: <Film size={15} /> },
  ] },
  { items: [
    { id: 'support', label: 'Help & feedback', icon: <LifeBuoy size={15} /> },
    { id: 'privacy', label: 'Privacy & legal', icon: <Lock size={15} /> },
    { id: 'about', label: 'About', icon: <Info size={15} /> },
  ] },
];

export function SettingsModal(props: Props) {
  return (
    <Modal title="Settings" onClose={props.onClose} width="min(1320px, calc(100vw - 48px))" className="settings-modal">
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings">
          {NAV.map((group, index) => (
            <div key={index} className="settings-nav-group">
              {group.title && <span className="settings-nav-label">{group.title}</span>}
              {group.items.map((item) => (
                <button key={item.id} type="button" className={props.tab === item.id ? 'active' : ''} aria-current={props.tab === item.id ? 'page' : undefined} onClick={() => props.onTab(item.id)}>
                  {item.icon} {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-body">
          {props.tab === 'brand' && <BrandKitSettings settings={props.settings} onSettings={props.onSettings} projectBrandKitId={props.projectBrandKitId ?? null} onProjectBrandKit={props.onProjectBrandKit ?? (() => undefined)} importMedia={props.importMedia} />}
          {props.tab === 'connectors' && <ConnectorsSettings settings={props.settings} onSettings={props.onSettings} />}
          {props.tab === 'local-media' && <LocalMediaSettings settings={props.settings} onSettings={props.onSettings} />}
          {props.tab === 'providers' && <ProvidersSettings providers={props.providers} onProviders={props.onProviders} settings={props.settings} onSettings={props.onSettings} jobs={props.jobs} />}
          {props.tab === 'speech' && <SpeechSettings settings={props.settings} onSettings={props.onSettings} jobs={props.jobs} />}
          {props.tab === 'media' && <MediaSettings {...props} />}
          {props.tab === 'storage' && <StorageSettings settings={props.settings} onSettings={props.onSettings} />}
          {props.tab === 'general' && <GeneralSettings settings={props.settings} onSettings={props.onSettings} providers={props.providers} info={props.info} onTab={props.onTab} onTour={props.onTour} />}
          {props.tab === 'appearance' && <AppearanceSettings settings={props.settings} onSettings={props.onSettings} />}
          {props.tab === 'avatar' && <AvatarSettings settings={props.settings} onSettings={props.onSettings} />}
          {props.tab === 'brain' && <BrainSettings settings={props.settings} onSettings={props.onSettings} />}
          {props.tab === 'privacy' && <PrivacySettings />}
          {props.tab === 'support' && <SupportSettings dataDir={props.info?.dataDir} onClose={props.onClose} />}
          {props.tab === 'about' && (
            // Layout lives in styles/about.css: one container-query grid, so every block shares the
            // same left/right edges and the same midline, and collapses by the panel's own width.
            <div className="about-v2">
              <header className="about-hero">
                <img className="about-logo" src="/bhippi.png" alt="" width={56} height={56} />
                <div className="about-ident">
                  <h3 className="about-title">
                    Bhippi Video Editor
                    {props.info?.version && <span className="about-pill">v{props.info.version}</span>}
                  </h3>
                  <p className="about-maker">Made by Aayush Datta</p>
                </div>
                <p className="about-intro">
                  A video and motion studio that runs on your own computer. Your footage is never uploaded to us, and
                  nothing is uploaded to render, transcribe or separate a subject. A cloud AI provider only sees what a
                  message to it needs. Settings › Privacy &amp; legal lists exactly what goes where.
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
                  the Bhippi desktop app. Caption styles come from WatchFIWN.
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
      <SettingsHeader title="Media &amp; FFmpeg">FFmpeg reads your media, builds previews and writes every export. Bhippi finds it on PATH and in WinGet, Scoop and Chocolatey installs.</SettingsHeader>

      <Section title="FFmpeg">
        <div className={`set-status${ffmpeg?.found ? ' ok' : ' missing'}`}>
          {ffmpeg?.found ? <Check size={16} /> : <TriangleAlert size={16} />}
          <div>
            <strong>{ffmpeg?.found ? `FFmpeg ${ffmpeg.version ?? ''}` : 'FFmpeg not found'}</strong>
            <span>{ffmpeg?.found ? ffmpeg.path : 'Install it with: winget install Gyan.FFmpeg — then press Detect.'}</span>
            {ffmpeg?.found && !ffmpeg.x264 && <span className="warn">This build has no libx264; exports use a slower fallback encoder.</span>}
            {ffmpeg?.found && <span>{ffmpeg.gpuEncoderLabel ? `GPU export encoder: ${ffmpeg.gpuEncoderLabel} (${ffmpeg.gpuEncoder})` : 'No working GPU export encoder — exports encode on the CPU.'}</span>}
          </div>
        </div>
        <Row stack title="Custom location" hint="Only needed when FFmpeg is somewhere Bhippi does not look.">
          <div className="field-inline">
            <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="C:\ffmpeg\bin" spellCheck={false} aria-label="FFmpeg folder" />
            <button type="button" className="btn" onClick={async () => { const picked = await openDialog({ directory: true, title: 'Folder containing ffmpeg.exe' }); if (typeof picked === 'string') setPath(picked); }}><FolderOpen size={14} /> Browse</button>
            <button type="button" className="btn btn-primary" onClick={() => void apply(path.trim() || null)} disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Detect</button>
          </div>
        </Row>
      </Section>

      <Section title="Library">
        <Row title="Data folder" hint={<code className="set-path" title={info?.dataDir}>{info?.dataDir}</code>}>
          <button type="button" className="btn" onClick={() => info && void api.openPath(info.dataDir)}><FolderOpen size={14} /> Open</button>
        </Row>
        <Row title="How imports are kept" hint="Files are used where they are unless Storage › Copy imported media is on. Thumbnails, waveforms, previews and settings live in the data folder; each project's own files live in its project folder." />
        <Row title="Supported files" hint={info?.extensions.join(', ')} />
      </Section>
    </div>
  );
}
