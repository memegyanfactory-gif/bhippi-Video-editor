import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Copy, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText, events } from '../lib/ipc';
import { actionLogger } from '../lib/actionLogger';
import '@xterm/xterm/css/xterm.css';

export function ShellTerminal({ active, cwd }: { active: boolean; cwd?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const session = useRef<string | null>(null);
  const starting = useRef(false);
  const alive = useRef(false);
  const pending = useRef<Parameters<Parameters<typeof events.terminal>[0]>[0][]>([]);
  const writes = useRef(Promise.resolve());
  const [state, setState] = useState('Not started');
  const [shell, setShell] = useState('Shell');
  const [folder, setFolder] = useState('');
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState('');

  const receive = useCallback((event: Parameters<Parameters<typeof events.terminal>[0]>[0]) => {
    if (starting.current && !session.current) { pending.current.push(event); return; }
    if (event.sessionId !== session.current) return;
    if (event.data.length) term.current?.write(new Uint8Array(event.data));
    if (event.error) { term.current?.writeln(`\r\n\x1b[31m${event.error}\x1b[0m`); actionLogger.error('Terminal stream error', event.error); }
    if (event.exitCode !== null || event.error) {
      term.current?.writeln(`\r\n\x1b[${event.exitCode === 0 ? '90' : '31'}m[Shell exited${event.exitCode !== null ? ` with code ${event.exitCode}` : ''}]\x1b[0m`);
      session.current = null; setState('Exited');
    }
  }, []);

  const start = useCallback(async () => {
    if (starting.current || !term.current) return;
    starting.current = true; setState('Starting…'); setFailure(''); pending.current = [];
    const previous = session.current; session.current = null;
    try {
      if (previous) await api.terminalClose(previous);
      fit.current?.fit();
      const opened = await api.terminalOpen(term.current.cols, term.current.rows, cwd);
      if (!alive.current) { await api.terminalClose(opened.sessionId); return; }
      session.current = opened.sessionId; setShell(opened.shell); setFolder(opened.cwd); setState('Running');
      starting.current = false;
      pending.current.splice(0).forEach(receive);
      term.current.focus();
    } catch (error) {
      if (alive.current) { setState('Unavailable'); setFailure(errorText(error)); actionLogger.error('Could not open terminal', error); }
    } finally { starting.current = false; }
  }, [cwd, receive]);

  useEffect(() => {
    if (!host.current) return;
    alive.current = true;
    const terminal = new Terminal({ cursorBlink: true, cursorStyle: 'bar', fontFamily: "'JetBrains Mono Variable', 'Cascadia Code', Consolas, monospace", fontSize: 12, lineHeight: 1.2, scrollback: 10000, convertEol: false, allowProposedApi: false });
    const addon = new FitAddon(); terminal.loadAddon(addon); terminal.open(host.current);
    term.current = terminal; fit.current = addon;
    let cancelled = false;
    const off = events.terminal(receive);
    void off.then(() => { if (!cancelled) setReady(true); }).catch((error) => { if (!cancelled) { setFailure(errorText(error)); setState('Unavailable'); } });
    const input = terminal.onData((data) => {
      const id = session.current;
      if (!id) return;
      // Preserve key/paste order even if one IPC write takes longer than the next.
      writes.current = writes.current.then(() => api.terminalWrite(id, data)).catch((error) => { actionLogger.error('Terminal input failed', error); });
    });
    terminal.attachCustomKeyEventHandler((event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && terminal.hasSelection()) {
        if (event.type === 'keydown') void navigator.clipboard.writeText(terminal.getSelection()).catch((error) => actionLogger.error('Could not copy terminal selection', error));
        return false;
      }
      return true;
    });
    const resize = terminal.onResize(({ cols, rows }) => {
      if (session.current) void api.terminalResize(session.current, cols, rows).catch((error) => actionLogger.warn('Terminal resize failed', error));
    });
    const observer = new ResizeObserver(() => {
      if (host.current && host.current.clientWidth > 0 && host.current.clientHeight > 0) addon.fit();
    });
    observer.observe(host.current);
    const theme = () => {
      const style = getComputedStyle(document.documentElement);
      terminal.options.theme = { background: style.getPropertyValue('--field').trim() || '#101014', foreground: style.getPropertyValue('--text').trim() || '#dedee5', cursor: style.getPropertyValue('--text').trim() || '#dedee5', selectionBackground: '#6b8cba55', red: '#ef7777', green: '#8ccc96', yellow: '#d9b774', blue: '#87b1ec' };
    };
    theme();
    const themes = new MutationObserver(theme); themes.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    return () => {
      cancelled = true; alive.current = false; setReady(false);
      observer.disconnect(); themes.disconnect(); input.dispose(); resize.dispose(); terminal.dispose(); term.current = null;
      void off.then((unlisten) => unlisten()).catch(() => undefined);
      if (session.current) { void api.terminalClose(session.current).catch(() => undefined); session.current = null; }
    };
  }, [receive]);

  useEffect(() => {
    if (!active || !ready) return;
    if (state === 'Not started') void start();
    fit.current?.fit(); term.current?.focus();
  }, [active, ready, state, start]);

  return <div className="shell-terminal" style={{ display: active ? 'flex' : 'none' }}>
    <div className="shell-toolbar"><span className="shell-name">{shell}</span><span className="shell-cwd" title={folder}>{folder || cwd || 'Current working directory'}</span><span className="shell-state">{state}</span>
      <button type="button" className="term-action-btn" title="Interrupt current command (Ctrl+C)" aria-label="Interrupt command" disabled={!session.current} onClick={() => { if (session.current) void api.terminalWrite(session.current, '\x03').catch((error) => actionLogger.error('Could not interrupt command', error)); }}><Square size={12} /></button>
      <button type="button" className="term-action-btn" title="Copy selection" aria-label="Copy terminal selection" onClick={() => { const text = term.current?.getSelection(); if (text) void navigator.clipboard.writeText(text).catch((error) => actionLogger.error('Could not copy selection', error)); }}><Copy size={12} /></button>
      <button type="button" className="term-action-btn" title="Clear scrollback" aria-label="Clear terminal" onClick={() => term.current?.clear()}><Trash2 size={12} /></button>
      <button type="button" className="term-action-btn" title="Restart shell" aria-label="Restart shell" disabled={starting.current || !ready} onClick={() => void start()}><RotateCcw size={12} /></button>
    </div>
    {failure && <div className="shell-failure" role="alert">{failure}<button type="button" className="btn btn-small" disabled={!ready || starting.current} onClick={() => void start()}>Retry</button></div>}
    <div className="shell-screen" ref={host} onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()} />
  </div>;
}
