// The Plugin Maker: a workspace over the editor where the user builds plugins by talking to
// Bhippi AI. Chat on the left (the same chat, with its own conversation and the Plugin Maker
// brief), the live plugin in the middle with its console under it, and the plugin's details,
// permissions, code and earlier versions on the right.

import { ArrowLeft, Code2, FileText, History, Plus, RotateCw, Send, Settings2, Shield, Store, Trash2, Upload, Download } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { errorText } from '../lib/ipc';
import { onPluginSaved, setSelectedPlugin } from './aiTools';
import { draftStore, syncDraftPage } from './drafts';
import { CATEGORIES, publish, type Category, type PublishStep } from './market';
import { pluginChecker } from './testRunner';
import { exportPackage, installPackage, legacyPlugin, MAX_PACKAGE_BYTES, PACKAGE_EXT, switchVersion, versionStore } from './package';
import { PluginFrame } from './PluginFrame';
import { pluginGlyph } from './PluginsPanel';
import { isSensitiveTool, pluginIdFor, validatePlugin } from './rules';
import { clearLogs, patchPlugin, reloadPlugin, removePlugin, savePlugin, usePlugins } from './store';
import type { Plugin } from './types';

type Tab = 'spec' | 'details' | 'permissions' | 'code' | 'versions';
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

export function PluginMaker({ chat, selected, onSelect, onPrompt, onClose, onMarket, known }: {
  chat: ReactNode;
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
    const key = (event: KeyboardEvent) => event.key === 'Escape' && !(event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const act = async (work: () => Promise<unknown>) => {
    setError('');
    setNotice('');
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
    <div className="plugin-maker" role="dialog" aria-modal="true" aria-label="Plugin Maker">
      <header className="pm-header">
        <button type="button" className="btn" onClick={onClose} title="Back to editor (Esc)"><ArrowLeft size={13} /> Editor</button>
        <h2>Plugin Maker</h2>
        <select className="composer-select" aria-label="Plugin" value={selected ?? ''} onChange={(event) => onSelect(event.target.value || null)}>
          <option value="">New plugin…</option>
          {plugins.map((item) => <option key={item.id} value={item.id}>{pluginGlyph(item)} {item.name}{item.enabled ? '' : ' (off)'}</option>)}
        </select>
        <button type="button" className="btn" onClick={() => onSelect(null)} title="Start a new plugin"><Plus size={13} /> New</button>
        <button type="button" className="btn" onClick={importPlugin} title="Install a .bhippi-plugin package (or an older .json export)"><Upload size={13} /> Import</button>
        {onMarket && <button type="button" className="btn" onClick={onMarket} title="Browse, install and publish plugins"><Store size={13} /> Marketplace</button>}
        <span className="pm-header-note">Plugins follow Bhippi's rules: every edit goes through Bhippi tools, your permission mode, and one Undo step.</span>
      </header>
      {error && <p className="pm-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss">×</button></p>}
      {notice && <p className="pm-notice" role="status">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss">×</button></p>}
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

        <aside className="pm-inspector">
          {plugin ? (
            <>
              <nav className="pm-tabs">
                {([['spec', 'Spec', FileText], ['details', 'Details', Settings2], ['permissions', 'Permissions', Shield], ['code', 'Code', Code2], ['versions', 'Versions', History]] as const).map(([id, label, Icon]) => (
                  <button key={id} type="button" className={tab === id ? 'on' : ''} onClick={() => setTab(id)}><Icon size={12} /> {label}</button>
                ))}
              </nav>
              <div className="pm-tab-body">
                {tab === 'spec' && <Spec key={`${plugin.id}:${plugin.revision}`} plugin={plugin} act={act} />}
                {tab === 'details' && <Details key={plugin.id} plugin={plugin} act={act} onExport={() => void exportPlugin(plugin)} onDeleted={() => onSelect(null)} onReview={() => setTab('permissions')} known={known} />}
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
