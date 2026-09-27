// The Plugin Maker: a workspace over the editor where the user builds plugins by talking to
// Bhippi AI. Chat on the left (the same chat, with its own conversation and the Plugin Maker
// brief), the live plugin in the middle with its console under it, and the plugin's details,
// permissions, code and earlier versions on the right.

import { ArrowLeft, Check, ChevronDown, Code2, ImagePlus, FileText, History, MessageCircleQuestion, Plus, Puzzle, RotateCw, Send, Settings2, Shield, Store, Trash2, TriangleAlert, Upload, Download, X } from 'lucide-react';
import type { ChatActivity } from '../chat/ChatPanel';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { errorText } from '../lib/ipc';
import { onPluginSaved, setSelectedPlugin } from './aiTools';
import { bytesToBase64, isAssetFile, isBinaryFile } from './assets';
import { draftStore, ensureDraft, isDraftFile, MAX_DRAFT_FILE_BYTES, syncDraftPage } from './drafts';
import { LOGO_FILE, logoImage, pickLogo } from './logo';
import { CATEGORIES, publish, type Category, type PublishStep } from './market';
import { pluginChecker } from './testRunner';
import { exportPackage, installPackage, legacyPlugin, MAX_PACKAGE_BYTES, PACKAGE_EXT, switchVersion, versionStore } from './package';
import { PluginFrame } from './PluginFrame';
import { PluginMark } from './PluginsPanel';
import { isSensitiveTool, pluginIdFor, validatePlugin } from './rules';
import { clearLogs, patchPlugin, reloadPlugin, removePlugin, savePlugin, usePlugins } from './store';
import type { Plugin } from './types';
import { isPluginService, PLUGIN_SERVICES, type PluginService } from './capabilities';

type Tab = 'spec' | 'details' | 'permissions' | 'code' | 'versions';
type Width = 'narrow' | 'wide' | 'full';
const WIDTHS: Record<Width, string> = { narrow: '340px', wide: '600px', full: '100%' };

// The two columns the user can drag: the chat on the left, the inspector on the right. The preview
// between them always keeps PREVIEW_MIN; HANDLES is the two 8px drag handles.
const CHAT_KEY = 'bhippi.pluginMaker.chatWidth';
const CHAT_DEFAULT = 460;
const CHAT_MIN = 380;
const CHAT_MAX = 760;
const SIDE_KEY = 'bhippi.pluginMaker.sideWidth';
const SIDE_DEFAULT = 320;
const SIDE_MIN = 260;
const SIDE_MAX = 560;
const PREVIEW_MIN = 300;
const HANDLES = 16;
const clampChat = (width: number, total: number, side: number) => Math.round(Math.max(CHAT_MIN, Math.min(CHAT_MAX, total - side - PREVIEW_MIN - HANDLES, width)));
const clampSide = (width: number, total: number, chat: number) => Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, total - chat - PREVIEW_MIN - HANDLES, width)));
const remembered = (key: string, fallback: number) => {
  try { return Number(localStorage.getItem(key)) || fallback; } catch { return fallback; }
};
const remember = (key: string, value: number) => {
  try { localStorage.setItem(key, String(value)); } catch { /* a remembered width is a convenience */ }
};

/** Ideas for an empty Maker, sent to the chat as the first message. */
const STARTERS = [
  { title: 'Shot list', prompt: 'Build a "Shot list" plugin: every clip of the active comp in timeline order with its track, name, start and duration; clicking a row selects the clip and moves the playhead to it. Keep it in sync as the project changes.' },
  { title: 'Quick actions', prompt: 'Build a "Quick actions" plugin: a grid of big buttons for my most common edits — add a marker at the playhead, split the selected clips at the playhead, add a lower-third title at the playhead, level the audio — each running the matching Bhippi tool.' },
  { title: 'Auto markers', prompt: 'Build a background automation plugin that watches the project and, whenever a new clip is added to the active comp, adds a marker at that clip\'s start named after the clip. Show a small log of what it did.' },
  { title: 'Webhook', prompt: 'Build a "Send to webhook" plugin: I paste a webhook URL once (saved in plugin storage), then a button posts a JSON summary of the project (name, comps, durations, clip counts) to it. Ask me for the host so the plugin gets network access to it.' },
  { title: 'Session timer', prompt: 'Build an editing session timer plugin: start/pause/reset, a 25-minute focus countdown with a toast when it ends, and today\'s total editing time saved in plugin storage.' },
];

export function PluginMaker({ chat, selected, onSelect, onPrompt, onClose, onMarket, known, hidden = false }: {
  chat: ReactNode;
  /** Out of sight while the user is back in the editor: still mounted, so a build keeps running. */
  hidden?: boolean;
  /** Opens the plugin marketplace. */
  onMarket?: () => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Sends a message to the Maker's chat. */
  onPrompt: (text: string) => void;
  onClose: () => void;
  known: ReadonlySet<string>;
}) {
  const { plugins, logs } = usePlugins();
  const plugin = plugins.find((item) => item.id === selected) ?? null;
  const [tab, setTab] = useState<Tab>('spec');
  const [width, setWidth] = useState<Width>('narrow');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // The AI tools read which plugin is open, and a plugin the AI saves becomes the open one.
  useEffect(() => {
    setSelectedPlugin(selected);
  }, [selected]);
  // One that came from outside and waits for review opens where the review is.
  const reviewing = !!plugin && (needsReview(plugin) || !!plugin.revoked);
  useEffect(() => {
    if (reviewing) setTab('permissions');
  }, [selected, reviewing]);
  useEffect(() => {
    onPluginSaved((id) => onSelect(id));
    return () => {
      onPluginSaved(null);
      setSelectedPlugin(null);
    };
  }, [onSelect]);
  useEffect(() => {
    if (hidden) return;
    // Esc with the Marketplace open over the Maker closes only the Marketplace.
    const key = (event: KeyboardEvent) => event.key === 'Escape' && !(event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) && !document.querySelector('.mk-backdrop') && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, hidden]);

  const act = async (work: () => Promise<unknown>) => {
    setError('');
    setNotice('');
    try {
      await work();
    } catch (problem) {
      setError(errorText(problem));
    }
  };

  // The chat and inspector columns: fixed widths the user drags within their limits (never so wide
  // that the preview between them loses its room); remembered across sessions.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [sideWidth, setSideWidth] = useState(() => clampSide(remembered(SIDE_KEY, SIDE_DEFAULT), window.innerWidth, CHAT_MIN));
  const [chatWidth, setChatWidth] = useState(() => clampChat(remembered(CHAT_KEY, CHAT_DEFAULT), window.innerWidth, sideWidth));
  const total = () => bodyRef.current?.clientWidth ?? window.innerWidth;
  const resizeChat = (width: number) => {
    const next = clampChat(width, total(), sideWidth);
    setChatWidth(next);
    remember(CHAT_KEY, next);
  };
  const resizeSide = (width: number) => {
    const next = clampSide(width, total(), chatWidth);
    setSideWidth(next);
    remember(SIDE_KEY, next);
  };
  /** Drags a handle: the chat's width is measured from the body's left edge, the inspector's from its right. */
  const startResize = (which: 'chat' | 'side') => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const rect = bodyRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const right = rect?.right ?? window.innerWidth;
    document.body.classList.add('pm-resizing');
    const move = (next: PointerEvent) => (which === 'chat' ? resizeChat(next.clientX - left) : resizeSide(right - next.clientX));
    const up = () => {
      document.body.classList.remove('pm-resizing');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  /** A drag handle: pointer drag, double-click to reset, ← → keys. */
  const splitter = (which: 'chat' | 'side') => {
    const chat = which === 'chat';
    const value = chat ? chatWidth : sideWidth;
    const resize = chat ? resizeChat : resizeSide;
    return (
      <div className="pm-split" role="separator" aria-orientation="vertical" aria-label={chat ? 'Resize the chat' : 'Resize the side panel'} tabIndex={0}
        aria-valuenow={value} aria-valuemin={chat ? CHAT_MIN : SIDE_MIN} aria-valuemax={chat ? CHAT_MAX : SIDE_MAX}
        title={`Drag to resize the ${chat ? 'chat' : 'side panel'} · double-click to reset`}
        onPointerDown={startResize(which)} onDoubleClick={() => resize(chat ? CHAT_DEFAULT : SIDE_DEFAULT)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          // The chat grows to the right; the side panel grows to the left.
          const step = (event.key === 'ArrowRight' ? 20 : -20) * (chat ? 1 : -1);
          resize(value + step);
        }} />
    );
  };

  const log = selected ? logs[selected] ?? [] : [];
  const consoleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = consoleRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [log.length]);

  /** A .bhippi-plugin package (checked, hash-verified, installed as a version) or a legacy .json export. */
  const importPlugin = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${PACKAGE_EXT},.json,application/json,application/zip`;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void act(async () => {
        if (file.name.toLowerCase().endsWith('.json')) {
          const raw = JSON.parse(await file.text()) as Partial<Plugin>;
          const saved = await savePlugin(legacyPlugin(raw, new Set(plugins.map((item) => item.id)), pluginIdFor), known, 'Imported');
          onSelect(saved.id);
          setTab('permissions');
          return;
        }
        if (file.size > MAX_PACKAGE_BYTES) throw new Error(`That package is ${Math.round(file.size / 1024)} KB; the limit is ${MAX_PACKAGE_BYTES / 1024} KB.`);
        const outcome = await installPackage(new Uint8Array(await file.arrayBuffer()), 'file', known);
        onSelect(outcome.plugin.id);
        setTab(outcome.waitsForReview ? 'permissions' : 'details');
        setNotice(outcome.update
          ? `Updated “${outcome.plugin.name}” from ${outcome.previous ?? 'an earlier version'} to ${outcome.plugin.pkg?.version}.${outcome.waitsForReview ? ' It asks for more than before, so it is off until you review it.' : ''}`
          : `Installed “${outcome.plugin.name}” ${outcome.plugin.pkg?.version}. It is off until you review what it may do.`);
      });
    };
    input.click();
  };

  /** The plugin as a .bhippi-plugin package: its draft, a schema-2 manifest and a lock of every file's hash. */
  const exportPlugin = (item: Plugin) =>
    act(async () => {
      const { bytes, fileName } = await exportPackage(item);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

  return (
    <div className="plugin-maker" role="dialog" aria-modal="true" aria-label="Plugin Maker" hidden={hidden}>
      <header className="pm-header">
        <div className="pm-header-side">
          <button type="button" className="btn" onClick={onClose} title="Back to editor (Esc)"><ArrowLeft size={13} /> Editor</button>
          <h2 title="Plugins follow Bhippi's rules: every edit goes through Bhippi tools, your permission mode, and one Undo step.">Plugin Maker</h2>
        </div>
        {/* Which plugin is open, centred at the top: the one thing the whole workspace is about. */}
        <PluginPicker plugins={plugins} current={plugin} onSelect={onSelect} />
        <div className="pm-header-side end">
          <button type="button" className="btn" onClick={() => onSelect(null)} title="Start a new plugin"><Plus size={13} /> New</button>
          <button type="button" className="btn" onClick={importPlugin} title="Install a .bhippi-plugin package (or an older .json export)"><Upload size={13} /> Import</button>
          {onMarket && <button type="button" className="btn" onClick={onMarket} title="Browse, install and publish plugins"><Store size={13} /> Marketplace</button>}
        </div>
      </header>
      {error && <p className="pm-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss">×</button></p>}
      {notice && <p className="pm-notice" role="status">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss">×</button></p>}
      <div className="pm-body" ref={bodyRef} style={{ ['--pm-chat-w' as string]: `${chatWidth}px`, ['--pm-side-w' as string]: `${sideWidth}px` }}>
        <aside className="pm-chat">{chat}</aside>
        {splitter('chat')}

        {/* The work area is the editor's slab: the preview and its console as panels on one darker
            surface, rounded all round, between the chat and the inspector. */}
        <div className="pm-slab">
          <section className="pm-stage">
            <div className="pm-preview">
              {plugin ? (
                <>
                  <div className="pm-preview-tools">
                    <div className="pm-seg" role="group" aria-label="Preview width">
                      {(['narrow', 'wide', 'full'] as Width[]).map((item) => <button key={item} type="button" className={width === item ? 'on' : ''} onClick={() => setWidth(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}
                    </div>
                    <button type="button" className="pm-tool" onClick={() => reloadPlugin(plugin.id)} title="Reload the plugin" aria-label="Reload the plugin"><RotateCw size={13} /></button>
                    <button type="button" className={`pm-tool text${plugin.panel ? ' on' : ''}`} onClick={() => void act(() => patchPlugin(plugin.id, { panel: !plugin.panel, enabled: true }))}>
                      {plugin.panel ? 'In Plugins panel ✓' : 'Add as panel'}
                    </button>
                  </div>
                  <div className="pm-preview-frame" style={{ width: WIDTHS[width] }}>{!hidden && <PluginFrame pluginId={plugin.id} />}</div>
                </>
              ) : (
                <div className="pm-starters">
                  <h3>What should your plugin do?</h3>
                  <p>Describe it in the chat — a tool, a dashboard, an automation, a link to another app. Bhippi AI writes a spec first, builds the plugin, tests it against a scratch copy of your project (your real project is never touched while testing), looks at it, and fixes it until it passes.</p>
                  <div className="pm-starter-grid">
                    {STARTERS.map((starter) => <button key={starter.title} type="button" className="pm-starter" onClick={() => onPrompt(starter.prompt)}><strong>{starter.title}</strong><span>{starter.prompt}</span></button>)}
                  </div>
                </div>
              )}
            </div>
            {plugin && (
              <div className="pm-console">
                <div className="pm-console-bar"><span>Console</span><span className="pm-dim">{log.filter((line) => line.level === 'error').length} errors</span><span className="pm-grow" /><button type="button" className="btn" onClick={() => clearLogs(plugin.id)}>Clear</button></div>
                <div className="pm-console-lines" ref={consoleRef}>
                  {log.length ? log.map((line, index) => <div key={index} className={`pm-log ${line.level}`}><time>{new Date(line.at).toLocaleTimeString()}</time>{line.text}</div>) : <div className="pm-dim">Nothing logged yet.</div>}
                </div>
              </div>
            )}
          </section>
        </div>

        {splitter('side')}
        {/* The inspector: its own surface on the right, one colour from its tabs to the bottom. */}
        <aside className="pm-inspector">
            {plugin ? (
              <>
                <header className="panel-tabs pm-tabs">
                  {([['spec', 'Spec', FileText], ['details', 'Details', Settings2], ['permissions', 'Permissions', Shield], ['code', 'Code', Code2], ['versions', 'Versions', History]] as const).map(([id, label, Icon]) => (
                    <div key={id} className={`panel-tab${tab === id ? ' active' : ''}`}>
                      <button type="button" className="panel-tab-label" onClick={() => setTab(id)}><Icon size={12} /> {label}</button>
                    </div>
                  ))}
                </header>
                <div className="pm-tab-body">
                  {tab === 'spec' && <Spec key={`${plugin.id}:${plugin.revision}`} plugin={plugin} act={act} />}
                  {tab === 'details' && <Details key={plugin.id} plugin={plugin} act={act} onExport={() => void exportPlugin(plugin)} onDeleted={() => onSelect(null)} onReview={() => setTab('permissions')} known={known} />}
                  {tab === 'permissions' && <Permissions key={plugin.id} plugin={plugin} known={known} act={act} />}
                  {tab === 'code' && <CodeEditor key={`${plugin.id}:${plugin.revision}`} plugin={plugin} known={known} act={act} />}
                  {tab === 'versions' && <Versions plugin={plugin} known={known} act={act} />}
                </div>
              </>
            ) : (
              <>
                <header className="panel-tabs pm-tabs"><div className="panel-tab active"><span className="panel-tab-label">Your plugins</span></div></header>
                <div className="pm-inspector-empty">
                  {plugins.length ? plugins.map((item) => (
                    <button key={item.id} type="button" className="pm-plugin-row" onClick={() => onSelect(item.id)}>
                      <span><PluginMark plugin={item} size={18} /></span><strong>{item.name}</strong><em>{item.description}</em>
                    </button>
                  )) : <span className="pm-dim">None yet.</span>}
                </div>
              </>
            )}
        </aside>
      </div>
    </div>
  );
}

/**
 * The Plugin Maker's corner badge while the user is back in the editor: a spinning plugin while a
 * build runs (with the step it is on), a question mark when the AI waits for an answer, and how the
 * build ended. Clicking it goes back into the Maker; the × cancels a running build, or dismisses a
 * finished one.
 */
export const makerActivityKey = (activity: ChatActivity) => (activity ? `${activity.turnId}:${activity.status}` : '');

export function MakerStatusBadge({ activity, asking, seen, onSeen, onOpen, onCancel }: {
  activity: ChatActivity;
  asking: boolean;
  /** The `makerActivityKey` the user already saw (in the Maker, or dismissed here): a finished build shows once. */
  seen: string;
  onSeen: (key: string) => void;
  onOpen: () => void;
  onCancel: () => void;
}) {
  const key = makerActivityKey(activity);
  const running = activity?.status === 'streaming';
  if (!activity || (!running && !asking && seen === key)) return null;
  const state = asking ? 'asking' : running ? 'working' : activity.status === 'done' ? 'done' : activity.status === 'error' ? 'error' : 'stopped';
  const title = { asking: 'Plugin Maker needs your answer', working: 'Building your plugin…', done: 'Plugin build finished', error: 'Plugin build hit a problem', stopped: 'Plugin build stopped' }[state];
  const detail = state === 'asking' ? 'Click to answer and keep it going' : state === 'working' ? activity.step ?? 'Thinking…' : 'Click to open the Plugin Maker';
  const Icon = { asking: MessageCircleQuestion, working: Puzzle, done: Check, error: TriangleAlert, stopped: Puzzle }[state];
  return (
    <div className={`pm-badge ${state}`} role="status" aria-live="polite">
      <button type="button" className="pm-badge-main" onClick={onOpen} title="Open the Plugin Maker">
        <span className="pm-badge-icon"><Icon size={18} /></span>
        <span className="pm-badge-text"><strong>{title}</strong><em>{detail}</em></span>
      </button>
      <button type="button" className="pm-badge-close" onClick={() => (running ? onCancel() : onSeen(key))}
        title={running ? 'Cancel the build' : 'Dismiss'} aria-label={running ? 'Cancel the build' : 'Dismiss'}><X size={14} /></button>
    </div>
  );
}

/**
 * The header's plugin switcher: the open plugin's mark (its uploaded logo, else its icon), name and
 * revision on a pill; a list of every plugin and "New plugin" below it. Arrow keys move through the
 * list, Enter picks, Esc or a click outside closes it.
 */
function PluginPicker({ plugins, current, onSelect }: { plugins: Plugin[]; current: Plugin | null; onSelect: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  // Row 0 is "New plugin"; the plugins follow.
  const rows: (Plugin | null)[] = [null, ...plugins];
  useEffect(() => {
    if (!open) return;
    setFocus(Math.max(0, rows.findIndex((row) => (row?.id ?? null) === (current?.id ?? null))));
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const pick = (row: Plugin | null) => { setOpen(false); onSelect(row?.id ?? null); };
  const onKey = (event: React.KeyboardEvent) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(true); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setFocus((index) => Math.min(rows.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setFocus((index) => Math.max(0, index - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); pick(rows[focus] ?? null); }
  };
  return (
    <div className={`pm-picker${open ? ' open' : ''}`} ref={ref} onKeyDown={onKey}>
      <button type="button" className="pm-picker-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} title="Switch plugin">
        <span className="pm-picker-mark">{current ? <PluginMark plugin={current} size={18} /> : <Plus size={14} />}</span>
        <span className="pm-picker-name">{current ? current.name : 'New plugin'}</span>
        {current && <span className="pm-picker-rev">rev {current.revision}</span>}
        <ChevronDown size={14} className="pm-picker-chevron" />
      </button>
      {open && (
        <div className="pm-picker-menu" role="listbox" aria-label="Plugins">
          <button type="button" role="option" aria-selected={!current} className={`pm-picker-row new${focus === 0 ? ' focus' : ''}`} onMouseEnter={() => setFocus(0)} onClick={() => pick(null)}>
            <span className="pm-picker-mark"><Plus size={14} /></span>
            <span className="pm-picker-text"><strong>New plugin</strong><em>Describe it and Bhippi AI builds it</em></span>
            {!current && <Check size={14} className="pm-picker-check" />}
          </button>
          {plugins.length > 0 && <div className="pm-picker-label">Your plugins</div>}
          {plugins.map((item, index) => (
            <button key={item.id} type="button" role="option" aria-selected={item.id === current?.id} className={`pm-picker-row${focus === index + 1 ? ' focus' : ''}${item.enabled ? '' : ' off'}`}
              onMouseEnter={() => setFocus(index + 1)} onClick={() => pick(item)}>
              <span className="pm-picker-mark"><PluginMark plugin={item} size={18} /></span>
              <span className="pm-picker-text"><strong>{item.name}</strong><em>{item.revoked ? 'Revoked' : item.enabled ? `Revision ${item.revision}` : 'Off'}</em></span>
              {item.id === current?.id && <Check size={14} className="pm-picker-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Act = (work: () => Promise<unknown>) => Promise<void>;

/**
 * Sets (or with null, removes) a plugin's uploaded logo: logo.svg in its draft, so the package and
 * the marketplace listing carry it, and the picture on the plugin itself, so it shows everywhere now.
 */
async function setPluginLogo(plugin: Plugin, text: string | null) {
  await ensureDraft(plugin);
  if (text) await draftStore.write(plugin.id, LOGO_FILE, text);
  else await draftStore.remove(plugin.id, LOGO_FILE).catch(() => undefined);
  await patchPlugin(plugin.id, { logo: text ? logoImage(text) ?? undefined : undefined });
}

/** The logo picker: the current mark on its tile, Upload and Remove. */
function LogoField({ plugin, onError }: { plugin: Plugin; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); } catch (problem) { onError(errorText(problem)); } finally { setBusy(false); }
  };
  return (
    <div className="pm-logo">
      <span className={`pm-logo-tile${plugin.logo ? ' has' : ''}`}><PluginMark plugin={plugin} size={56} /></span>
      <span className="pm-logo-text">
        <strong>Logo</strong>
        <em>{plugin.logo ? 'Shown in the Plugins panel, its tab and the marketplace.' : 'Upload a square image (PNG, JPEG, WebP, GIF or SVG). Until then the emoji icon is used.'}</em>
        <span className="pm-row">
          <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => { const text = await pickLogo(); if (text) await setPluginLogo(plugin, text); })}>
            <ImagePlus size={13} /> {plugin.logo ? 'Change…' : 'Upload logo…'}
          </button>
          {plugin.logo && <button type="button" className="btn" disabled={busy} onClick={() => void run(() => setPluginLogo(plugin, null))}>Remove</button>}
        </span>
      </span>
    </div>
  );
}

/** The file name an uploaded asset gets in the draft: plain characters, its own ending. */
const assetName = (file: string) => file.normalize('NFKD').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[-.]+|-+(?=\.)/g, '').slice(-64);

/**
 * The plugin's assets (pictures, models, fonts, sounds, clips, wasm): files in its draft that
 * plugin_save bundles into the page, where bhippi.asset(name) reads them.
 */
function AssetsField({ plugin, onError }: { plugin: Plugin; onError: (message: string) => void }) {
  const [files, setFiles] = useState<{ name: string; bytes: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => void draftStore.list(plugin.id).then((list) => setFiles(list.filter((file) => isAssetFile(file.name))), () => setFiles([]));
  useEffect(refresh, [plugin.id, plugin.revision]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); } catch (problem) { onError(errorText(problem)); } finally { setBusy(false); refresh(); }
  };
  const upload = (picked: FileList | null) => void run(async () => {
    await ensureDraft(plugin);
    for (const file of Array.from(picked ?? [])) {
      const name = assetName(file.name);
      if (!isDraftFile(name) || !isBinaryFile(name)) throw new Error(`${file.name}: choose a picture, model, font, sound, clip or wasm file.`);
      if (file.size > MAX_DRAFT_FILE_BYTES) throw new Error(`${file.name} is larger than ${MAX_DRAFT_FILE_BYTES / 1024 / 1024} MB.`);
      await draftStore.write(plugin.id, name, bytesToBase64(new Uint8Array(await file.arrayBuffer())));
    }
  });
  return (
    <div className="pm-logo pm-assets">
      <span className="pm-logo-text">
        <strong>Assets</strong>
        <em>Pictures, 3D models, fonts, sounds, clips or wasm the plugin uses (up to {MAX_DRAFT_FILE_BYTES / 1024 / 1024} MB each). They are bundled the next time it is saved; ask Bhippi AI to use them.</em>
        {files.length > 0 && (
          <ul className="pm-asset-list">
            {files.map((file) => (
              <li key={file.name}>
                <code>{file.name}</code><span>{file.bytes >= 1024 * 1024 ? `${(file.bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.bytes / 1024))} KB`}</span>
                <button type="button" className="btn pm-asset-remove" title={`Remove ${file.name}`} disabled={busy} onClick={() => void run(() => draftStore.remove(plugin.id, file.name))}><Trash2 size={12} /></button>
              </li>
            ))}
          </ul>
        )}
        <span className="pm-row">
          <input ref={input} type="file" multiple hidden onChange={(event) => { upload(event.target.files); event.target.value = ''; }} />
          <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}><Upload size={13} /> Add assets…</button>
        </span>
      </span>
    </div>
  );
}

const STEP_LABEL: Record<PublishStep, string> = { checking: 'Checking the draft…', testing: 'Testing it against a scratch copy of your project…', packing: 'Packing it…', sending: 'Sending it to bhippi.com…' };

/** The next patch version after `version`. */
const bump = (version: string | undefined) => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '');
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : '1.0.0';
};

/**
 * Publishing to the marketplace: the same gate the Maker holds itself to (a clean draft, a Judge
 * pass on a real test run), then the package goes to bhippi.com for review.
 */
function Publish({ plugin, known }: { plugin: Plugin; known: ReadonlySet<string> }) {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(plugin.pkg ? bump(plugin.pkg.version) : '1.0.0');
  const [category, setCategory] = useState<Category>('utility');
  const [step, setStep] = useState<PublishStep | null>(null);
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);
  if (!open) return <button type="button" className="btn" onClick={() => setOpen(true)}><Send size={13} /> Publish to the marketplace…</button>;
  const go = async () => {
    setResult(null);
    try {
      const outcome = await publish(plugin.id, { version: version.trim(), category, known, checker: pluginChecker, onStep: setStep });
      setResult(outcome.ok
        ? { ok: true, lines: [`Version ${outcome.version} was sent for review. You will see the result in Marketplace › My submissions.`, ...outcome.warnings.map((warning) => `Note: ${warning}`)] }
        : { ok: false, lines: outcome.problems });
    } catch (failure) {
      setResult({ ok: false, lines: [errorText(failure)] });
    } finally {
      setStep(null);
    }
  };
  return (
    <div className="pm-publish">
      <h4>Publish to the marketplace</h4>
      <LogoField plugin={plugin} onError={(message) => setResult({ ok: false, lines: [message] })} />
      <p className="pm-dim">Anyone using Bhippi can then install it. It is tested here first (it must pass the Judge), then checked on bhippi.com and reviewed by Bhippi before it goes live. Sensitive tools are not accepted yet.</p>
      <div className="pm-row">
        <label>Version<input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0.0" /></label>
        <label className="pm-grow">Category<select value={category} onChange={(event) => setCategory(event.target.value as Category)}>{CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      <div className="pm-row">
        <span className="pm-dim">{step ? STEP_LABEL[step] : ''}</span>
        <span className="pm-grow" />
        <button type="button" className="btn" disabled={!!step} onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!!step || !version.trim()} onClick={() => void go()}><Send size={13} /> Publish</button>
      </div>
      {result && <ul className={result.ok ? 'pm-publish-ok' : 'pm-publish-problems'}>{result.lines.map((line) => <li key={line}>{line}</li>)}</ul>}
    </div>
  );
}

/** What a plugin may do that the user should read before it runs; `danger` for sensitive tools. */
export function pluginRisks(plugin: Plugin): { text: string; danger: boolean }[] {
  const { tools, network, chat } = plugin.permissions;
  const risks: { text: string; danger: boolean }[] = [];
  for (const name of tools.filter((item) => item !== '*' && isSensitiveTool(item))) risks.push({ text: `${name}: a sensitive tool (shell, files, deletes, memory, network, paid generation or an MCP server)`, danger: true });
  if (tools.includes('*')) risks.push({ text: 'Every editing tool (“*”): it can change anything in your project', danger: false });
  const edits = tools.filter((item) => item !== '*' && !isSensitiveTool(item));
  if (edits.length) risks.push({ text: `Edits your project with: ${edits.join(', ')}`, danger: false });
  for (const host of network) risks.push({ text: `Connects to ${host}`, danger: false });
  if (chat) risks.push({ text: 'Suggests messages for Bhippi AI (each one needs your click)', danger: false });
  for (const name of plugin.permissions.services ?? []) if (isPluginService(name)) risks.push({ text: PLUGIN_SERVICES[name].risk, danger: false });
  return risks;
}

/** A plugin from outside this app (a file or a package) that is off: it waits for the user's review. */
export const needsReview = (plugin: Plugin) => !plugin.enabled && plugin.author === 'user';

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="pm-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span><strong>{label}</strong><em>{hint}</em></span>
    </label>
  );
}

/**
 * The plugin's contract (the draft's spec.md): what it does, its UI, the tools it calls, its
 * permissions and the acceptance checks plugin_test runs. The AI writes it first; the user can
 * change it here, and the next build follows it.
 */
function Spec({ plugin, act }: { plugin: Plugin; act: Act }) {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  useEffect(() => {
    let live = true;
    draftStore.read(plugin.id, 'spec.md').then(
      (spec) => { if (live) { setText(spec); setSaved(spec); } },
      () => { if (live) { setText(''); setSaved(''); } },
    );
    return () => { live = false; };
  }, [plugin.id, plugin.revision]);
  if (text === null) return <p className="pm-dim">Loading the spec…</p>;
  const changed = text !== saved;
  return (
    <div className="pm-form pm-code">
      <p className="pm-dim">The plugin's contract: Bhippi AI writes it before the code and tests the plugin against its acceptance checks. Change it and ask the AI to follow it.</p>
      <textarea spellCheck={false} value={text} placeholder="No spec yet — the Plugin Maker writes one before it builds." onChange={(event) => setText(event.target.value)} />
      <div className="pm-row">
        <span className="pm-dim">{changed ? 'Unsaved changes' : 'spec.md'}</span>
        <span className="pm-grow" />
        <button type="button" className="btn" disabled={!changed} onClick={() => setText(saved)}>Discard</button>
        <button type="button" className="btn btn-primary" disabled={!changed} onClick={() => void act(async () => { await draftStore.write(plugin.id, 'spec.md', text); setSaved(text); })}>Save spec</button>
      </div>
    </div>
  );
}

function Details({ plugin, act, onExport, onDeleted, onReview, known }: { plugin: Plugin; act: Act; onExport: () => void; onDeleted: () => void; onReview: () => void; known: ReadonlySet<string> }) {
  const [name, setName] = useState(plugin.name);
  const [icon, setIcon] = useState(plugin.icon ?? '');
  const [description, setDescription] = useState(plugin.description);
  const [confirming, setConfirming] = useState(false);
  const commit = () => {
    if (name.trim() === plugin.name && icon.trim() === (plugin.icon ?? '') && description.trim() === plugin.description) return;
    if (!name.trim()) return setName(plugin.name);
    void act(() => patchPlugin(plugin.id, { name: name.trim().slice(0, 60), icon: icon.trim().slice(0, 8) || undefined, description: description.trim() }));
  };
  return (
    <div className="pm-form">
      <LogoField plugin={plugin} onError={(message) => void act(() => Promise.reject(new Error(message)))} />
      <AssetsField plugin={plugin} onError={(message) => void act(() => Promise.reject(new Error(message)))} />
      <div className="pm-row">
        <label className="pm-icon">Icon<input value={icon} onChange={(event) => setIcon(event.target.value)} onBlur={commit} placeholder="🧩" /></label>
        <label className="pm-grow">Name<input value={name} onChange={(event) => setName(event.target.value)} onBlur={commit} /></label>
      </div>
      <label>Description<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} onBlur={commit} /></label>
      <Toggle label="Enabled" hint={needsReview(plugin) ? 'Off. It came from outside this app: review what it may do (Permissions) before it runs.' : 'Off: never loads, not offered to Bhippi AI.'} checked={plugin.enabled} onChange={(enabled) => (enabled && needsReview(plugin) ? onReview() : void act(() => patchPlugin(plugin.id, { enabled })))} />
      <Toggle label="Show as panel" hint="A tab in the Plugins panel (Window › Plugins)." checked={plugin.panel} onChange={(panel) => void act(() => patchPlugin(plugin.id, { panel, ...(panel ? { enabled: true } : {}) }))} />
      <Toggle label="Run in background" hint="Keeps running with no panel open — for automations." checked={plugin.background} onChange={(background) => void act(() => patchPlugin(plugin.id, { background }))} />
      {plugin.revoked && <p className="pm-error">Pulled from the marketplace on {new Date(plugin.revoked.at * 1000).toLocaleDateString()}: {plugin.revoked.reason}. It stays off; install a newer version or delete it.</p>}
      <p className="pm-dim">id <code>{plugin.id}</code> · {plugin.pkg ? `version ${plugin.pkg.version}${plugin.pkg.author ? ` by ${plugin.pkg.author}` : ''} · from ${plugin.pkg.source === 'marketplace' ? 'the marketplace' : 'a package file'}` : plugin.author === 'ai' ? 'built by Bhippi AI' : 'added by you'} · {Math.round(plugin.html.length / 1024)} KB</p>
      {plugin.author === 'ai' || !plugin.pkg || plugin.pkg.source === 'local' ? <Publish plugin={plugin} known={known} /> : null}
      <div className="pm-row">
        <button type="button" className="btn" onClick={onExport} title="Save as a .bhippi-plugin package anyone can import"><Download size={13} /> Export package</button>
        <span className="pm-grow" />
        {confirming ? (
          <>
            <button type="button" className="btn btn-danger" onClick={() => void act(async () => { await removePlugin(plugin.id); onDeleted(); })}>Delete for good</button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>Keep</button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirming(true)}><Trash2 size={13} /> Delete…</button>
        )}
      </div>
    </div>
  );
}

function Permissions({ plugin, known, act }: { plugin: Plugin; known: ReadonlySet<string>; act: Act }) {
  const [tool, setTool] = useState('');
  const [host, setHost] = useState('');
  const { tools, network, chat } = plugin.permissions;
  const all = tools.includes('*');
  const choices = useMemo(() => [...known].filter((name) => !tools.includes(name)).sort(), [known, tools]);
  const save = (next: Plugin['permissions']) =>
    act(async () => {
      const problem = validatePlugin({ ...plugin, permissions: next }, known);
      if (problem) throw new Error(problem);
      await patchPlugin(plugin.id, { permissions: next });
    });
  const named = tools.filter((name) => name !== '*');
  const risks = pluginRisks(plugin);
  return (
    <div className="pm-form">
      {needsReview(plugin) && (
        <div className="pm-consent" role="alert">
          <strong>“{plugin.name}” is off until you turn it on.</strong>
          <span>It came from {plugin.pkg ? `a package${plugin.pkg.author ? ` by ${plugin.pkg.author}` : ''} (version ${plugin.pkg.version})` : 'a file'}, not from this app. {risks.length ? 'Read what it may do:' : 'It only reads the project and makes no risky calls.'}</span>
          {!!risks.length && <ul>{risks.map((risk) => <li key={risk.text} className={risk.danger ? 'warn' : ''}>{risk.text}</li>)}</ul>}
          <div className="pm-row"><span className="pm-grow" /><button type="button" className="btn btn-primary" onClick={() => void act(() => patchPlugin(plugin.id, { enabled: true }))}>I trust it — turn it on</button></div>
        </div>
      )}
      <p className="pm-dim">Reading the project is always allowed. Everything else is only what you give it here — and your permission mode (Plan only / Auto-edit / Full access) still applies on top.</p>
      <Toggle label="All editing tools" hint="Every Bhippi tool except the sensitive ones (shell, files, deletes), which must be named." checked={all} onChange={(on) => void save({ ...plugin.permissions, tools: on ? ['*', ...named] : named })} />
      <div className="pm-chips">
        {named.map((name) => (
          <span key={name} className={`pm-chip${isSensitiveTool(name) ? ' warn' : ''}`} title={isSensitiveTool(name) ? 'Sensitive tool' : undefined}>
            {name}<button type="button" aria-label={`Remove ${name}`} onClick={() => void save({ ...plugin.permissions, tools: tools.filter((item) => item !== name) })}>×</button>
          </span>
        ))}
        {!named.length && !all && <span className="pm-dim">No editing tools.</span>}
      </div>
      <div className="pm-row">
        <input className="pm-grow" list="pm-tool-names" value={tool} onChange={(event) => setTool(event.target.value)} placeholder="Add a tool, e.g. add_marker" />
        <datalist id="pm-tool-names">{choices.map((name) => <option key={name} value={name} />)}</datalist>
        <button type="button" className="btn" disabled={!tool.trim()} onClick={() => { const name = tool.trim(); setTool(''); void save({ ...plugin.permissions, tools: [...tools, name] }); }}>Add</button>
      </div>
      <h4>Network</h4>
      <div className="pm-chips">
        {network.map((entry) => <span key={entry} className="pm-chip">{entry}<button type="button" aria-label={`Remove ${entry}`} onClick={() => void save({ ...plugin.permissions, network: network.filter((item) => item !== entry) })}>×</button></span>)}
        {!network.length && <span className="pm-dim">No network access.</span>}
      </div>
      <div className="pm-row">
        <input className="pm-grow" value={host} onChange={(event) => setHost(event.target.value)} placeholder="api.example.com or http://127.0.0.1:5678" />
        <button type="button" className="btn" disabled={!host.trim()} onClick={() => { const entry = host.trim(); setHost(''); void save({ ...plugin.permissions, network: [...network, entry] }); }}>Add</button>
      </div>
      <Toggle label="Talk to Bhippi AI" hint="May suggest messages for the chat (bhippi.chat); each one reaches Bhippi AI only when you click Send." checked={chat} onChange={(on) => void save({ ...plugin.permissions, chat: on })} />
      <h4>Services</h4>
      {(Object.keys(PLUGIN_SERVICES) as PluginService[]).map((name) => {
        const services = plugin.permissions.services ?? [];
        return (
          <Toggle key={name} label={PLUGIN_SERVICES[name].label} hint={PLUGIN_SERVICES[name].risk} checked={services.includes(name)}
            onChange={(on) => void save({ ...plugin.permissions, services: on ? [...services.filter((item) => item !== name), name] : services.filter((item) => item !== name) })} />
        );
      })}
    </div>
  );
}

function CodeEditor({ plugin, known, act }: { plugin: Plugin; known: ReadonlySet<string>; act: Act }) {
  const [html, setHtml] = useState(plugin.html);
  const changed = html !== plugin.html;
  return (
    <div className="pm-form pm-code">
      <textarea spellCheck={false} value={html} onChange={(event) => setHtml(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Tab') {
          event.preventDefault();
          const target = event.currentTarget;
          const { selectionStart: start, selectionEnd: end } = target;
          setHtml(`${html.slice(0, start)}  ${html.slice(end)}`);
          requestAnimationFrame(() => target.setSelectionRange(start + 2, start + 2));
        }
        if (event.key === 's' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          if (changed) void act(async () => { await savePlugin({ ...plugin, html, author: plugin.author }, known, 'Edited by hand'); await syncDraftPage(plugin.id, html); });
        }
      }} />
      <div className="pm-row">
        <span className="pm-dim">{changed ? 'Unsaved changes' : `Revision ${plugin.revision}`}</span>
        <span className="pm-grow" />
        <button type="button" className="btn" disabled={!changed} onClick={() => setHtml(plugin.html)}>Discard</button>
        <button type="button" className="btn btn-primary" disabled={!changed} onClick={() => void act(async () => { await savePlugin({ ...plugin, html }, known, 'Edited by hand'); await syncDraftPage(plugin.id, html); })}>Save (Ctrl+S)</button>
      </div>
    </div>
  );
}

function Versions({ plugin, known, act }: { plugin: Plugin; known: ReadonlySet<string>; act: Act }) {
  const revisions = plugin.revisions ?? [];
  const [installed, setInstalled] = useState<{ version: string; installedMs: number }[]>([]);
  useEffect(() => {
    let live = true;
    if (plugin.pkg) void versionStore.versions(plugin.id).then((list) => live && setInstalled(list), () => undefined);
    return () => { live = false; };
  }, [plugin.id, plugin.pkg]);
  return (
    <div className="pm-form">
      {plugin.pkg && (
        <>
          <h4>Installed versions</h4>
          <p className="pm-dim">The last three versions installed from packages stay on disk. Switching runs the checked files of that version; one that asks for more than the running one waits for your review.</p>
          {installed.map((item) => (
            <div key={item.version} className="pm-version">
              <span><strong>{item.version}{item.version === plugin.pkg?.version ? ' (running)' : ''}</strong><em>installed {new Date(item.installedMs).toLocaleString()}</em></span>
              {item.version !== plugin.pkg?.version && <button type="button" className="btn" onClick={() => void act(() => switchVersion(plugin.id, item.version, known))}>Use this version</button>}
            </div>
          ))}
          <h4>Edits</h4>
        </>
      )}
      {revisions.length ? revisions.map((revision, index) => (
        <div key={`${revision.at}-${index}`} className="pm-version">
          <span><strong>{new Date(revision.at).toLocaleString()}</strong><em>replaced by: {revision.note}</em></span>
          <button type="button" className="btn" onClick={() => void act(async () => { await savePlugin({ ...plugin, html: revision.html }, known, `Restored the version from ${new Date(revision.at).toLocaleString()}`); await syncDraftPage(plugin.id, revision.html); })}>Restore</button>
        </div>
      )) : <p className="pm-dim">No earlier edits yet. Each change keeps the page before it (the last 10).</p>}
    </div>
  );
}
