import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Terminal as TerminalIcon,
  Trash2,
  Copy,
  ChevronDown,
  Search,
  AlertCircle,
  Sparkles,
  User,
  Cpu,
  Check,
  Play,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { actionLogger, type ActionLogItem, type LogCategory } from '../lib/actionLogger';
import { api } from '../lib/ipc';

interface TerminalPanelProps {
  open: boolean;
  onClose: () => void;
  height?: number;
  onHeightChange?: (h: number) => void;
}

export function TerminalPanel({ open, onClose, height = 280, onHeightChange }: TerminalPanelProps) {
  const [logs, setLogs] = useState<ActionLogItem[]>([]);
  const [filter, setFilter] = useState<'all' | LogCategory>('all');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [commandInput, setCommandInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [copied, setCopied] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(height);

  // Subscribe to live logs
  useEffect(() => {
    return actionLogger.subscribe((newLogs) => {
      setLogs(newLogs);
    });
  }, []);

  // Auto-scroll when new logs arrive
  useEffect(() => {
    if (open && autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, open, autoScroll]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Resize handling
  const onMouseDownResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startY.current = e.clientY;
    startHeight.current = height;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startY.current - moveEvent.clientY;
      const nextH = Math.max(140, Math.min(window.innerHeight - 100, startHeight.current + delta));
      onHeightChange?.(nextH);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [height, onHeightChange]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const counts = useMemo(() => {
    let ai = 0;
    let user = 0;
    let system = 0;
    let error = 0;
    for (const item of logs) {
      if (item.category === 'ai') ai++;
      else if (item.category === 'user') user++;
      else if (item.category === 'system') system++;
      else if (item.category === 'error') error++;
    }
    return { all: logs.length, ai, user, system, error };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((item) => {
      if (filter !== 'all' && item.category !== filter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchDetail = item.detail ? item.detail.toLowerCase().includes(q) : false;
        if (!matchTitle && !matchDetail) return false;
      }
      return true;
    });
  }, [logs, filter, search]);

  const copyAllLogs = () => {
    const text = filteredLogs
      .map((l) => `[${l.timeStr}] [${l.category.toUpperCase()}] ${l.title}${l.detail ? `\n  ${l.detail.replace(/\n/g, '\n  ')}` : ''}`)
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCommandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = commandInput.trim();
    if (!cmd) return;

    setCommandHistory((prev) => [...prev, cmd]);
    setHistoryIdx(-1);
    setCommandInput('');

    actionLogger.user(`> ${cmd}`);

    const parts = cmd.split(' ');
    const primary = parts[0].toLowerCase();

    switch (primary) {
      case 'clear':
      case 'cls':
        actionLogger.clear();
        break;

      case 'help':
        actionLogger.system(
          'Terminal Commands:\n' +
          '  clear               Clear logs\n' +
          '  status              Show app status\n' +
          '  crash               Inspect backend crash.log\n' +
          '  jobs                List running background jobs\n' +
          '  subagents           List active subagents\n' +
          '  filter <category>   Filter by all | ai | user | system | error\n' +
          '  echo <message>      Log message to terminal\n' +
          '  copy                Copy visible logs'
        );
        break;

      case 'status': {
        try {
          const info = await api.appInfo();
          actionLogger.system('System Status', info);
        } catch (err) {
          actionLogger.error('Failed to get app status', err);
        }
        break;
      }

      case 'jobs': {
        try {
          const jobs = await api.jobsList();
          actionLogger.system(`Active Jobs (${jobs.length})`, jobs);
        } catch (err) {
          actionLogger.error('Failed to get jobs', err);
        }
        break;
      }

      case 'crash': {
        try {
          // Read workspace todos/notes or crash file if available
          const notes = await api.workspaceNotes().catch(() => []);
          actionLogger.system('Checking crash diagnostics...', {
            notes,
            crashLocation: '%APPDATA%\\com.bhippi.videoeditor\\crash.log',
          });
        } catch (err) {
          actionLogger.error('Failed to check crash log', err);
        }
        break;
      }

      case 'filter': {
        const cat = parts[1]?.toLowerCase();
        if (cat === 'all' || cat === 'ai' || cat === 'user' || cat === 'system' || cat === 'error') {
          setFilter(cat as typeof filter);
          actionLogger.system(`Filter set to: ${cat}`);
        } else {
          actionLogger.warn('Invalid filter category. Use: all | ai | user | system | error');
        }
        break;
      }

      case 'echo':
        actionLogger.system(parts.slice(1).join(' '));
        break;

      case 'copy':
        copyAllLogs();
        actionLogger.system('Logs copied to clipboard');
        break;

      default:
        actionLogger.warn(`Unknown command: "${primary}". Type "help" for a list of commands.`);
        break;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const nextIdx = historyIdx === -1 ? commandHistory.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(nextIdx);
      setCommandInput(commandHistory[nextIdx] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx === -1) return;
      const nextIdx = historyIdx + 1;
      if (nextIdx >= commandHistory.length) {
        setHistoryIdx(-1);
        setCommandInput('');
      } else {
        setHistoryIdx(nextIdx);
        setCommandInput(commandHistory[nextIdx] ?? '');
      }
    }
  };

  if (!open) return null;

  const currentHeight = isMaximized ? window.innerHeight - 80 : height;

  return (
    <div
      className="terminal-drawer"
      style={{ height: currentHeight }}
      role="region"
      aria-label="Action and Developer Terminal"
    >
      {/* Resizer Handle */}
      <div
        className="terminal-resizer"
        onMouseDown={onMouseDownResize}
        title="Drag to resize terminal"
      >
        <div className="resizer-knob" />
      </div>

      {/* Terminal Header */}
      <div className="terminal-header">
        <div className="terminal-title-group">
          <TerminalIcon size={14} className="terminal-icon" />
          <strong className="terminal-title">Terminal &amp; Actions</strong>
          <span className="terminal-badge">{counts.all}</span>
          {counts.error > 0 && (
            <span className="terminal-pill error" title={`${counts.error} errors recorded`}>
              <AlertCircle size={11} /> {counts.error}
            </span>
          )}
        </div>

        {/* Category Filters */}
        <div className="terminal-filters">
          <button
            type="button"
            className={`term-filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            type="button"
            className={`term-filter-btn ai ${filter === 'ai' ? 'active' : ''}`}
            onClick={() => setFilter('ai')}
          >
            <Sparkles size={11} /> AI ({counts.ai})
          </button>
          <button
            type="button"
            className={`term-filter-btn user ${filter === 'user' ? 'active' : ''}`}
            onClick={() => setFilter('user')}
          >
            <User size={11} /> User ({counts.user})
          </button>
          <button
            type="button"
            className={`term-filter-btn sys ${filter === 'system' ? 'active' : ''}`}
            onClick={() => setFilter('system')}
          >
            <Cpu size={11} /> System ({counts.system})
          </button>
        </div>

        {/* Search */}
        <div className="terminal-search-wrap">
          <Search size={12} className="search-icon" />
          <input
            type="text"
            className="terminal-search-input"
            placeholder="Filter logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Actions */}
        <div className="terminal-actions">
          <button
            type="button"
            className={`term-action-btn ${autoScroll ? 'active' : ''}`}
            onClick={() => setAutoScroll((v) => !v)}
            title="Auto-scroll with new logs"
          >
            Follow {autoScroll ? 'On' : 'Off'}
          </button>
          <button
            type="button"
            className="term-action-btn"
            onClick={copyAllLogs}
            title="Copy visible logs to clipboard"
          >
            {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className="term-action-btn"
            onClick={() => actionLogger.clear()}
            title="Clear all logs"
          >
            <Trash2 size={12} /> Clear
          </button>
          <button
            type="button"
            className="term-action-btn"
            onClick={() => setIsMaximized((v) => !v)}
            title={isMaximized ? 'Restore height' : 'Maximize terminal'}
          >
            {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button
            type="button"
            className="term-action-btn close-btn"
            onClick={onClose}
            title="Close terminal (drop down)"
          >
            <ChevronDown size={14} />
          </button>
        </div>
      </div>

      {/* Logs Scroll Area */}
      <div className="terminal-body" ref={scrollRef}>
        {filteredLogs.length === 0 ? (
          <div className="terminal-empty">
            <span className="muted">No actions recorded yet. Interact with Bhippi or ask the AI copilot to see live actions here.</span>
          </div>
        ) : (
          filteredLogs.map((item) => {
            const isExpanded = expandedIds.has(item.id);
            return (
              <div
                key={item.id}
                className={`term-row cat-${item.category} level-${item.level} ${isExpanded ? 'expanded' : ''}`}
                onClick={() => item.detail && toggleExpand(item.id)}
              >
                <span className="term-time">{item.timeStr}</span>
                <span className={`term-tag tag-${item.category}`}>
                  {item.category === 'ai' && <Sparkles size={9} />}
                  {item.category === 'user' && <User size={9} />}
                  {item.category === 'system' && <Cpu size={9} />}
                  {item.category === 'error' && <AlertCircle size={9} />}
                  {item.category.toUpperCase()}
                </span>
                <span className="term-title">
                  {item.title}
                  {item.detail && <span className="term-has-detail"> {isExpanded ? '▾' : '▸'}</span>}
                </span>
                {isExpanded && item.detail && (
                  <pre className="term-detail">{item.detail}</pre>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Terminal Command Input Prompt */}
      <form className="terminal-prompt" onSubmit={handleCommandSubmit}>
        <span className="prompt-symbol">
          <Play size={10} />
        </span>
        <input
          ref={inputRef}
          type="text"
          className="prompt-input"
          placeholder="Type command (e.g. 'help', 'status', 'crash', 'clear') or view live actions above..."
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="submit" className="prompt-submit">
          Run
        </button>
      </form>
    </div>
  );
}
