// Plugin Lab (plugin-lab.html, `npm run dev:web` → /plugin-lab.html): a plugin running through the
// real bridge, rules and runTool against an in-memory project, outside the app. `?html=` is not
// taken — edit SAMPLE below, or build one in the Plugin Maker and paste it here.
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import '../styles/app.css';
import { KNOWN_TOOLS, runTool, TOOL_SPECS, type ToolHost } from '../lib/aiTools';
import { useHistory } from '../lib/history';
import { newProject } from '../lib/timeline';
import { setPluginEditor } from './bridge';
import { PluginFrame } from './PluginFrame';
import { savePlugin, usePlugins } from './store';
import type { Plugin } from './types';

const SAMPLE = `<div style="padding:10px"><h3 style="margin:0 0 8px">Plugin self-test</h3>
<div id="out" style="font:11px var(--mono);white-space:pre-wrap"></div>
<button class="primary" id="mark">Add marker</button></div>
<script>
const out = document.getElementById('out');
const line = (t) => { out.textContent += t + String.fromCharCode(10); console.log(t); };
(async () => {
  const info = await bhippi.ready;
  line('ready: ' + info.name);
  const p = await bhippi.project();
  line('project: ' + p.project.name + ', comps ' + p.comps.length);
  try { await bhippi.tool('delete_clips', { clipIds: ['x'] }); line('delete_clips: ALLOWED (bad)'); } catch (e) { line('delete_clips refused: ' + e.message); }
  try { await fetch('https://example.com'); line('fetch: ALLOWED (bad)'); } catch (e) { line('fetch blocked'); }
  try { void parent.document.title; line('parent DOM: REACHABLE (bad)'); } catch (e) { line('parent DOM blocked'); }
  try { localStorage.x = 1; line('localStorage: REACHABLE (bad)'); } catch (e) { line('localStorage blocked'); }
  bhippi.expose('ping', { description: 'answers pong' }, async () => 'pong');
  const mark = async () => {
    try { const r = await bhippi.tool('add_marker', { time: 1.5, name: 'From plugin' }); line('add_marker: ' + r.summary); }
    catch (e) { line('add_marker failed: ' + e.message); }
  };
  document.getElementById('mark').addEventListener('click', mark);
  await mark();
  const c = await bhippi.comp();
  line('markers now: ' + c.markers.length);
})();
</script>`;

function Lab() {
  const history = useHistory(newProject('Lab project'));
  const [selection, setSelection] = useState<string[]>([]);
  const { logs } = usePlugins();
  const host = useMemo<ToolHost>(() => ({
    history, assets: () => new Map(), selection: () => selection, setSelection,
    importMedia: async () => [], speak: async () => { throw new Error('no speech in the lab'); }, ask: async () => '',
  }), [history, selection]);
  useEffect(() => {
    setPluginEditor({
      host: () => ({ ...host, history: { ...host.history, commit: (...args: Parameters<typeof host.history.commit>) => flushSync(() => host.history.commit(...args)) } }),
      runTool: (h, name, args) => runTool(h, name, args), known: KNOWN_TOOLS, toolSpecs: () => TOOL_SPECS,
      permission: () => 'edit', disableLocalGeneration: () => true,
      toast: (tone, title, body) => console.info(`[toast ${tone}] ${title}: ${body}`), chat: (message) => console.info(`[chat] ${message}`), projectPath: () => null,
    });
  }, [host]);
  useEffect(() => {
    const now = new Date().toISOString();
    const plugin: Plugin = { version: 1, id: 'self-test', name: 'Self test', description: 'lab', icon: '🧪', html: SAMPLE, permissions: { tools: ['add_marker'], network: [], chat: false }, background: false, enabled: true, panel: true, author: 'user', createdAt: now, updatedAt: now, revision: 1 };
    void savePlugin(plugin, KNOWN_TOOLS);
  }, []);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', height: '100vh' }}>
      <div style={{ display: 'flex' }}><PluginFrame pluginId="self-test" /></div>
      <pre id="lab-log" style={{ margin: 0, padding: 10, overflow: 'auto', font: '11px monospace' }}>
        {`undo: ${history.undoLabel ?? '-'}\n\n`}{(logs['self-test'] ?? []).map((line) => `${line.level} ${line.text}`).join('\n')}
      </pre>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>);
