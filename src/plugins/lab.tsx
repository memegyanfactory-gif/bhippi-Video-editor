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
import { renderPluginFrame, setPluginEditor } from './bridge';
import { PluginFrame } from './PluginFrame';
import { PluginClipRenderers } from './PluginsPanel';
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
  // Phase 2 escapes: each must be refused.
  const refused = async (label, run) => { try { await run(); line(label + ': ALLOWED (bad)'); } catch (e) { line(label + ' refused: ' + e.message.slice(0, 90)); } };
  await refused('mcp tool', () => bhippi.tool('mcp__github__create_issue', {}));
  await refused('read_file', () => bhippi.tool('read_file', { path: 'C:/Windows/win.ini' }));
  await refused('scrape_web_page', () => bhippi.tool('scrape_web_page', { url: 'https://example.com' }));
  await refused('get_plugin', () => bhippi.tool('get_plugin', { id: 'self-test' }));
  await refused('set_playhead', () => bhippi.tool('set_playhead', { time: 3 }));
  await refused('fileUrl outside', () => bhippi.fileUrl('C:/Users/me/.ssh/id_rsa'));
  await refused('chat without permission', () => bhippi.chat('hi'));
  bhippi.expose('ping', { description: 'answers pong' }, async () => 'pong');
  const mark = async () => {
    try { const r = await bhippi.tool('add_marker', { time: 1.5, name: 'From plugin' }); line('add_marker: ' + r.summary); }
    catch (e) { line('add_marker failed: ' + e.message); }
  };
  document.getElementById('mark').addEventListener('click', mark);
  await mark();
  const c = await bhippi.comp();
  line('markers now: ' + c.markers.length);
  // Last, since it spends the minute's budget of tool calls.
  let slowed = '';
  for (let i = 0; i < 125 && !slowed; i++) { try { await bhippi.tool('get_comp', {}); } catch (e) { slowed = e.message; } }
  line(slowed ? 'rate limit: ' + slowed.slice(0, 60) : 'rate limit: NONE (bad)');
})();
</script>`;

/** A plugin that draws a clip (bhippi.generator): dots whose size follows the sound it is given. */
const GENERATOR = `<script>
bhippi.ready.then(() => bhippi.generator('dots', { label: 'Dots', params: { color: { type: 'color', default: '#ff3b6b' } } }, (ctx, info) => {
  ctx.fillStyle = info.params.color;
  for (let i = 0; i < 16; i++) {
    ctx.beginPath();
    ctx.arc((i + 0.5) * info.width / 16, info.height / 2, 4 + info.audio.bands[i * 4] * 40 * info.u * 4, 0, Math.PI * 2);
    ctx.fill();
  }
}));
</script>`;

/** Asks the generator plugin's hidden render page for a frame, as the preview and the export do. */
function RenderCheck() {
  const [result, setResult] = useState('rendering…');
  useEffect(() => {
    let alive = true;
    const audio = { rms: 0.4, peak: 0.8, loading: false, waveform: [], smooth: [], bands: Array.from({ length: 64 }, (_, i) => 1 - i / 64) };
    const info = { time: 1, duration: 4, progress: 0.25, compTime: 1, fps: 30, frame: 30, width: 320, height: 180, u: 320 / 1920, exporting: false, audio };
    void renderPluginFrame({ id: 'gen-test', generator: 'dots', params: {} }, info)
      .then((bitmap) => {
        const canvas = document.getElementById('lab-render') as HTMLCanvasElement;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(bitmap, 0, 0);
        const { data } = context.getImageData(0, 0, 320, 180);
        let lit = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
        if (alive) setResult(`render: ${bitmap.width}x${bitmap.height}, ${lit} pixels drawn`);
        bitmap.close();
      })
      .catch((error: Error) => alive && setResult(`render failed: ${error.message}`));
    return () => { alive = false; };
  }, []);
  return <div><canvas id="lab-render" width={320} height={180} style={{ background: '#000' }} /><div id="lab-render-result">{result}</div></div>;
}

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
      toast: (tone, title, body) => console.info(`[toast ${tone}] ${title}: ${body}`), chat: (message, pluginName) => console.info(`[chat suggestion from ${pluginName}] ${message}`), projectPath: () => null,
      ai: () => ({ providerId: null, model: null }), job: (job) => console.info(`[job ${job.status}] ${job.label} ${Math.round(job.progress * 100)}%`),
    });
  }, [host]);
  useEffect(() => {
    const now = new Date().toISOString();
    const plugin: Plugin = { version: 1, id: 'self-test', name: 'Self test', description: 'lab', icon: '🧪', html: SAMPLE, permissions: { tools: ['add_marker'], network: [], chat: false }, background: false, enabled: true, panel: true, author: 'user', createdAt: now, updatedAt: now, revision: 1 };
    void savePlugin(plugin, KNOWN_TOOLS);
    void savePlugin({ ...plugin, id: 'gen-test', name: 'Generator test', html: GENERATOR, permissions: { tools: [], network: [], chat: false } }, KNOWN_TOOLS);
  }, []);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', height: '100vh' }}>
      <div style={{ display: 'flex' }}><PluginFrame pluginId="self-test" /></div>
      <div style={{ overflow: 'auto' }}>
        <PluginClipRenderers pluginIds={['gen-test']} />
        <RenderCheck />
        <pre id="lab-log" style={{ margin: 0, padding: 10, font: '11px monospace' }}>
          {`undo: ${history.undoLabel ?? '-'}\n\n`}{(logs['self-test'] ?? []).map((line) => `${line.level} ${line.text}`).join('\n')}
        </pre>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>);
