// The Plugin Maker: a workspace over the editor where the user builds plugins by talking to
// Bhippi AI. Chat on the left (the same chat, with its own conversation and the Plugin Maker
// brief), the live plugin in the middle with its console under it, and the plugin's details,
// permissions, code and earlier versions on the right.

import { ArrowLeft, Code2, History, Plus, RotateCw, Settings2, Shield, Trash2, Upload, Download } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { errorText } from '../lib/ipc';
import { onPluginSaved, setSelectedPlugin } from './aiTools';
import { PluginFrame } from './PluginFrame';
import { pluginGlyph } from './PluginsPanel';
import { isSensitiveTool, pluginIdFor, validatePlugin } from './rules';
import { clearLogs, patchPlugin, reloadPlugin, removePlugin, savePlugin, usePlugins } from './store';
import type { Plugin } from './types';

type Tab = 'details' | 'permissions' | 'code' | 'versions';
type Width = 'narrow' | 'wide' | 'full';
const WIDTHS: Record<Width, string> = { narrow: '340px', wide: '600px', full: '100%' };

/** Ideas for an empty Maker, sent to the chat as the first message. */
const STARTERS = [
  { title: 'Shot list', prompt: 'Build a "Shot list" plugin: every clip of the active comp in timeline order with its track, name, start and duration; clicking a row selects the clip and moves the playhead to it. Keep it in sync as the project changes.' },
  { title: 'Quick actions', prompt: 'Build a "Quick actions" plugin: a grid of big buttons for my most common edits — add a marker at the playhead, split the selected clips at the playhead, add a lower-third title at the playhead, level the audio — each running the matching Bhippi tool.' },
  { title: 'Auto markers', prompt: 'Build a background automation plugin that watches the project and, whenever a new clip is added to the active comp, adds a marker at that clip\'s start named after the clip. Show a small log of what it did.' },
  { title: 'Webhook', prompt: 'Build a "Send to webhook" plugin: I paste a webhook URL once (saved in plugin storage), then a button posts a JSON summary of the project (name, comps, durations, clip counts) to it. Ask me for the host so the plugin gets network access to it.' },
  { title: 'Session timer', prompt: 'Build an editing session timer plugin: start/pause/reset, a 25-minute focus countdown with a toast when it ends, and today\'s total editing time saved in plugin storage.' },
];

export function PluginMaker({ chat, selected, onSelect, onPrompt, onClose, known }: {
  chat: ReactNode;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Sends a message to the Maker's chat. */
  onPrompt: (text: string) => void;
  onClose: () => void;
  known: ReadonlySet<string>;
}) {
  const { plugins, logs } = usePlugins();
  const plugin = plugins.find((item) => item.id === selected) ?? null;
  const [tab, setTab] = useState<Tab>('details');
  const [width, setWidth] = useState<Width>('narrow');
  const [error, setError] = useState('');

  // The AI tools read which plugin is open, and a plugin the AI saves becomes the open one.
  useEffect(() => {
    setSelectedPlugin(selected);
  }, [selected]);
  useEffect(() => {
    onPluginSaved((id) => onSelect(id));
    return () => {
      onPluginSaved(null);
      setSelectedPlugin(null);
    };
  }, [onSelect]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === 'Escape' && !(event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const act = async (work: () => Promise<unknown>) => {
    setError('');
    try {
      await work();
    } catch (problem) {
      setError(errorText(problem));
    }
  };

  const log = selected ? logs[selected] ?? [] : [];
  const consoleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = consoleRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [log.length]);

  const importPlugin = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void act(async () => {
        const raw = JSON.parse(await file.text()) as Partial<Plugin>;
        if (typeof raw.html !== 'string' || typeof raw.name !== 'string') throw new Error('That file is not a Bhippi plugin.');
        const now = new Date().toISOString();
        const taken = new Set(plugins.map((item) => item.id));
        const imported: Plugin = {
          version: 1, id: pluginIdFor(raw.name, taken), name: raw.name, description: String(raw.description ?? ''), icon: raw.icon, html: raw.html,
          permissions: { tools: raw.permissions?.tools ?? [], network: raw.permissions?.network ?? [], chat: !!raw.permissions?.chat },
          // An imported plugin starts off: the user reads its permissions before it runs.
          background: !!raw.background, enabled: false, panel: false, author: 'user', createdAt: now, updatedAt: now, revision: 1,
        };
        const saved = await savePlugin(imported, known, 'Imported');
        onSelect(saved.id);
        setTab('permissions');
      });
    };
    input.click();
  };

  const exportPlugin = (item: Plugin) => {
    const { revisions: _revisions, ...rest } = item;
    void _revisions;
    const url = URL.createObjectURL(new Blob([JSON.stringify(rest, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${item.id}.bhippi-plugin.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="plugin-maker" role="dialog" aria-modal="true" aria-label="Plugin Maker">
      <header className="pm-header">
        <button type="button" className="btn" onClick={onClose} title="Back to editor (Esc)"><ArrowLeft size={13} /> Editor</button>
        <h2>Plugin Maker</h2>
        <select className="composer-select" aria-label="Plugin" value={selected ?? ''} onChange={(event) => onSelect(event.target.value || null)}>
          <option value="">New plugin…</option>
          {plugins.map((item) => <option key={item.id} value={item.id}>{pluginGlyph(item)} {item.name}{item.enabled ? '' : ' (off)'}</option>)}
        </select>
        <button type="button" className="btn" onClick={() => onSelect(null)} title="Start a new plugin"><Plus size={13} /> New</button>
        <button type="button" className="btn" onClick={importPlugin} title="Import a .bhippi-plugin.json file"><Upload size={13} /> Import</button>
        <span className="pm-header-note">Plugins follow Bhippi's rules: every edit goes through Bhippi tools, your permission mode, and one Undo step.</span>
      </header>
      {error && <p className="pm-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss">×</button></p>}
      <div className="pm-body">
        <aside className="pm-chat">{chat}</aside>

        <section className="pm-stage">
          <div className="pm-stage-bar">
            {plugin ? (
              <>
                <strong>{pluginGlyph(plugin)} {plugin.name}</strong>
                <span className="pm-dim">rev {plugin.revision}</span>
                <span className="pm-grow" />
                <div className="pm-seg" role="group" aria-label="Preview width">
                  {(['narrow', 'wide', 'full'] as Width[]).map((item) => <button key={item} type="button" className={width === item ? 'on' : ''} onClick={() => setWidth(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}
                </div>
                <button type="button" className="btn" onClick={() => reloadPlugin(plugin.id)} title="Reload the plugin"><RotateCw size={13} /></button>
                <button type="button" className={`btn${plugin.panel ? ' on' : ''}`} onClick={() => void act(() => patchPlugin(plugin.id, { panel: !plugin.panel, enabled: true }))}>
                  {plugin.panel ? 'In Plugins panel ✓' : 'Add as panel'}
                </button>
              </>
            ) : (
              <strong>New plugin</strong>
            )}
          </div>
          <div className="pm-preview">
            {plugin ? (
              <div className="pm-preview-frame" style={{ width: WIDTHS[width] }}><PluginFrame pluginId={plugin.id} /></div>
            ) : (
              <div className="pm-starters">
                <h3>What should your plugin do?</h3>
                <p>Describe it in the chat — a tool, a dashboard, an automation, a link to another app. Bhippi AI knows the whole editor and every tool, writes the plugin, runs it here, reads its console and fixes it.</p>
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

        <aside className="pm-inspector">
          {plugin ? (
            <>
              <nav className="pm-tabs">
                {([['details', 'Details', Settings2], ['permissions', 'Permissions', Shield], ['code', 'Code', Code2], ['versions', 'Versions', History]] as const).map(([id, label, Icon]) => (
                  <button key={id} type="button" className={tab === id ? 'on' : ''} onClick={() => setTab(id)}><Icon size={12} /> {label}</button>
                ))}
              </nav>
              <div className="pm-tab-body">
                {tab === 'details' && <Details key={plugin.id} plugin={plugin} act={act} onExport={() => exportPlugin(plugin)} onDeleted={() => onSelect(null)} />}
                {tab === 'permissions' && <Permissions key={plugin.id} plugin={plugin} known={known} act={act} />}
                {tab === 'code' && <CodeEditor key={`${plugin.id}:${plugin.revision}`} plugin={plugin} known={known} act={act} />}
                {tab === 'versions' && <Versions plugin={plugin} known={known} act={act} />}
              </div>
            </>
          ) : (
            <div className="pm-inspector-empty">
              <p>Your plugins</p>
              {plugins.length ? plugins.map((item) => (
                <button key={item.id} type="button" className="pm-plugin-row" onClick={() => onSelect(item.id)}>
                  <span>{pluginGlyph(item)}</span><strong>{item.name}</strong><em>{item.description}</em>
                </button>
              )) : <span className="pm-dim">None yet.</span>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

type Act = (work: () => Promise<unknown>) => Promise<void>;

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="pm-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span><strong>{label}</strong><em>{hint}</em></span>
    </label>
  );
}

function Details({ plugin, act, onExport, onDeleted }: { plugin: Plugin; act: Act; onExport: () => void; onDeleted: () => void }) {
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
      <div className="pm-row">
        <label className="pm-icon">Icon<input value={icon} onChange={(event) => setIcon(event.target.value)} onBlur={commit} placeholder="🧩" /></label>
        <label className="pm-grow">Name<input value={name} onChange={(event) => setName(event.target.value)} onBlur={commit} /></label>
      </div>
      <label>Description<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} onBlur={commit} /></label>
      <Toggle label="Enabled" hint="Off: never loads, not offered to Bhippi AI." checked={plugin.enabled} onChange={(enabled) => void act(() => patchPlugin(plugin.id, { enabled }))} />
      <Toggle label="Show as panel" hint="A tab in the Plugins panel (Window › Plugins)." checked={plugin.panel} onChange={(panel) => void act(() => patchPlugin(plugin.id, { panel, ...(panel ? { enabled: true } : {}) }))} />
      <Toggle label="Run in background" hint="Keeps running with no panel open — for automations." checked={plugin.background} onChange={(background) => void act(() => patchPlugin(plugin.id, { background }))} />
      <p className="pm-dim">id <code>{plugin.id}</code> · {plugin.author === 'ai' ? 'built by Bhippi AI' : 'added by you'} · {Math.round(plugin.html.length / 1024)} KB</p>
      <div className="pm-row">
        <button type="button" className="btn" onClick={onExport}><Download size={13} /> Export</button>
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
  return (
    <div className="pm-form">
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
      <Toggle label="Talk to Bhippi AI" hint="May send messages to the chat (bhippi.chat), as if you typed them." checked={chat} onChange={(on) => void save({ ...plugin.permissions, chat: on })} />
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
          if (changed) void act(() => savePlugin({ ...plugin, html, author: plugin.author }, known, 'Edited by hand'));
        }
      }} />
      <div className="pm-row">
        <span className="pm-dim">{changed ? 'Unsaved changes' : `Revision ${plugin.revision}`}</span>
        <span className="pm-grow" />
        <button type="button" className="btn" disabled={!changed} onClick={() => setHtml(plugin.html)}>Discard</button>
        <button type="button" className="btn btn-primary" disabled={!changed} onClick={() => void act(() => savePlugin({ ...plugin, html }, known, 'Edited by hand'))}>Save (Ctrl+S)</button>
      </div>
    </div>
  );
}

function Versions({ plugin, known, act }: { plugin: Plugin; known: ReadonlySet<string>; act: Act }) {
  const revisions = plugin.revisions ?? [];
  if (!revisions.length) return <p className="pm-dim">No earlier versions yet. Each change keeps the version before it (the last 10).</p>;
  return (
    <div className="pm-form">
      {revisions.map((revision, index) => (
        <div key={`${revision.at}-${index}`} className="pm-version">
          <span><strong>{new Date(revision.at).toLocaleString()}</strong><em>replaced by: {revision.note}</em></span>
          <button type="button" className="btn" onClick={() => void act(() => savePlugin({ ...plugin, html: revision.html }, known, `Restored the version from ${new Date(revision.at).toLocaleString()}`))}>Restore</button>
        </div>
      ))}
    </div>
  );
}
