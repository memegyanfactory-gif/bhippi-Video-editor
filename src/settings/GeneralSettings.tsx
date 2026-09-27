// Settings › General: the handful of choices most people make first — the look, which AI answers
// and how much it may do, the editor's extras, where projects live and how updates arrive. Each
// row is the same setting its own page shows in full; this page only gathers them.
import { ChevronRight, Compass, FolderOpen, LoaderCircle } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { Toggle, useToast } from '../components/ui';
import { api, errorText, type StorageInfo } from '../lib/ipc';
import { DEFAULT_PERMISSION, PERMISSION_MODES } from '../lib/permissions';
import { registerStorageRoot } from '../lib/storage';
import { glassBackdrop, resolveGlass, resolveTheme, THEMES } from '../lib/theme';
import type { AppInfo, ProviderInfo, Settings } from '../lib/types';
import { Row, Section, SettingsHeader } from './SettingsLayout';
import { chooseStorageRoot } from './StorageSettings';
import type { SettingsTab } from './SettingsModal';

type Props = {
  settings: Settings;
  onSettings: (settings: Settings) => void;
  providers: ProviderInfo[];
  info: AppInfo | null;
  onTab: (tab: SettingsTab) => void;
  /** Closes Settings and runs the welcome tour. */
  onTour?: () => void;
};

const CACHE_SIZES = [512, 1024, 1536, 2048, 3072, 4096];

export function GeneralSettings({ settings, onSettings, providers, info, onTab, onTour }: Props) {
  const toast = useToast();
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    void api.storageInfo().then(setStorage).catch(() => undefined);
  }, []);

  const set = (patch: Partial<Settings>) => onSettings({ ...settings, ...patch });
  const theme = resolveTheme(settings);
  const glass = resolveGlass(settings);
  const usable = providers.filter((row) => row.usable && row.enabled);
  const permission = PERMISSION_MODES.some((mode) => mode.id === settings.permission) ? settings.permission : DEFAULT_PERMISSION;
  const cacheOn = settings.previewCacheEnabled ?? true;

  const moveProjects = async () => {
    setMoving(true);
    try {
      const next = await chooseStorageRoot(storage?.root ?? null);
      if (next) {
        registerStorageRoot(next.root);
        setStorage(next);
        set({ storageRoot: next.custom ? next.root : null });
        toast({ tone: 'success', title: 'Storage location changed', body: 'New files go there. Nothing already saved was moved.' });
      }
    } catch (error) {
      toast({ tone: 'error', title: 'Could not use that folder', body: errorText(error) });
    } finally {
      setMoving(false);
    }
  };

  const more = (tab: SettingsTab, label: string) => (
    <button type="button" className="set-link" onClick={() => onTab(tab)}>{label} <ChevronRight size={12} /></button>
  );

  return (
    <div className="general-settings">
      <SettingsHeader title="General">The settings most people reach for first. Every page on the left has the full detail.</SettingsHeader>

      <Section title="Look" actions={more('appearance', 'Appearance')}>
        <Row title="Theme" hint={THEMES.find((item) => item.id === theme)?.detail}>
          <div className="theme-dots" role="radiogroup" aria-label="Color theme">
            {THEMES.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={theme === item.id} title={item.name} aria-label={item.name}
                className={`theme-dot${theme === item.id ? ' active' : ''}`} style={{ '--dot': item.id === 'glass' ? glassBackdrop(glass, true) : item.preview.bg, '--dot-accent': item.preview.accent } as CSSProperties}
                onClick={() => set({ theme: item.id })} />
            ))}
          </div>
        </Row>
      </Section>

      <Section title="Bhippi AI" actions={more('providers', 'AI providers')}>
        <Row title="Default provider" hint={usable.length ? 'Which AI answers in the chat. You can switch any time from the chat too.' : 'No provider is ready yet — add a key or install a CLI under AI providers.'}>
          <select value={settings.providerId ?? ''} onChange={(event) => set({ providerId: event.target.value || null, model: null })} disabled={!usable.length} aria-label="Default provider">
            <option value="">Automatic</option>
            {usable.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
          </select>
        </Row>
        <Row title="What the AI may change" hint={PERMISSION_MODES.find((mode) => mode.id === permission)?.hint}>
          <div className="segmented" role="radiogroup" aria-label="AI permission">
            {PERMISSION_MODES.map((mode) => (
              <button key={mode.id} type="button" role="radio" aria-checked={permission === mode.id} className={permission === mode.id ? 'active' : ''} onClick={() => set({ permission: mode.id })}>{mode.label}</button>
            ))}
          </div>
        </Row>
        <Row title="Generate images and video on this computer" hint="Off: the AI finds real footage online instead. Local models stay available when you ask for them.">
          <Toggle checked={!(settings.disableLocalGeneration ?? true)} onChange={(on) => set({ disableLocalGeneration: !on })} label="Local generation" />
        </Row>
        <Row title="Generate clips with online models" hint={<>Higgsfield, Magnific (Freepik), Veo, Runway, Kling and more on your own keys. You approve every prompt first. {more('connectors', 'Connectors')}</>}>
          <Toggle checked={settings.cloudGeneration?.enabled ?? false} onChange={(on) => set({ cloudGeneration: { ...settings.cloudGeneration, enabled: on } })} label="Cloud generation" />
        </Row>
      </Section>

      <Section title="Editor">
        <Row title="Pixel avatar" hint="A little producer who acts out what Bhippi AI is doing on your timeline.">
          <Toggle checked={settings.avatar === true} onChange={(on) => set({ avatar: on })} label="Pixel avatar" />
        </Row>
        <Row title="RAM preview cache" hint="Keeps rendered frames in memory so playback of effects-heavy parts stays smooth.">
          {cacheOn && (
            <select value={settings.previewCacheMb ?? 1536} onChange={(event) => set({ previewCacheMb: Number(event.target.value) })} aria-label="Preview cache size">
              {CACHE_SIZES.map((mb) => <option key={mb} value={mb}>{mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`}</option>)}
            </select>
          )}
          <Toggle checked={cacheOn} onChange={(on) => set({ previewCacheEnabled: on })} label="RAM preview cache" />
        </Row>
      </Section>

      <Section title="Getting started">
        <Row title="Welcome tour" hint="A five-step walk through the chat, AI providers, project area, timeline and preview. Shown once, the first time Bhippi opens after it is installed.">
          {onTour && <button type="button" className="btn" onClick={onTour}><Compass size={14} /> Show tour</button>}
          <Toggle checked={settings.tour !== false} onChange={(on) => set({ tour: on })} label="Welcome tour" />
        </Row>
      </Section>

      <Section title="Projects and files" actions={more('storage', 'Storage')}>
        <Row title="Projects folder" hint={<code className="set-path" title={storage?.root}>{storage?.root ?? '…'}</code>}>
          <button type="button" className="btn" onClick={() => void moveProjects()} disabled={moving}>{moving ? <LoaderCircle size={14} className="spin" /> : <FolderOpen size={14} />} Change…</button>
        </Row>
        <Row title="Copy imported media into the project" hint="The project folder then holds everything and can be moved as one.">
          <Toggle checked={settings.copyImports === true} onChange={(on) => set({ copyImports: on })} label="Copy imported media" />
        </Row>
      </Section>

      <Section title="Updates" actions={more('about', 'About')}>
        <Row title="Download updates automatically" hint={`Bhippi ${info?.version ? `v${info.version}` : ''} — installing always waits for you.`}>
          <Toggle checked={settings.autoUpdate !== false} onChange={(on) => set({ autoUpdate: on })} label="Download updates automatically" />
        </Row>
      </Section>
    </div>
  );
}
