// Centralized action and telemetry logger for Helios.
// Records every single action performed by the user, the AI copilot, subagents, and the system runtime.

export type LogCategory = 'ai' | 'user' | 'system' | 'error';
export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export interface ActionLogItem {
  id: string;
  timestamp: number;
  timeStr: string;
  category: LogCategory;
  level: LogLevel;
  title: string;
  detail?: string;
  raw?: unknown;
}

type Listener = (logs: ActionLogItem[]) => void;

class ActionLogger {
  private items: ActionLogItem[] = [];
  private listeners = new Set<Listener>();
  private maxItems = 2000;

  constructor() {
    // Intercept unhandled window errors
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        this.error('Unhandled window error', {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          error: event.error?.stack || event.error,
        });
      });

      window.addEventListener('unhandledrejection', (event) => {
        this.error('Unhandled Promise Rejection', {
          reason: event.reason?.stack || event.reason?.message || String(event.reason),
        });
      });
    }

    // Initial system log
    this.system('Helios Action Logger initialized', {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'desktop',
      timestamp: new Date().toISOString(),
    });
  }

  private emit() {
    const slice = this.getLogs();
    for (const listener of this.listeners) {
      try {
        listener(slice);
      } catch (err) {
        console.error('Logger listener failed', err);
      }
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getLogs());
    return () => this.listeners.delete(listener);
  }

  public getLogs(): ActionLogItem[] {
    return [...this.items];
  }

  public clear() {
    this.items = [];
    this.emit();
  }

  public log(category: LogCategory, level: LogLevel, title: string, raw?: unknown) {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
    
    let detail: string | undefined;
    if (raw !== undefined) {
      try {
        if (typeof raw === 'string') {
          detail = raw;
        } else if (raw instanceof Error) {
          detail = `${raw.message}\n${raw.stack || ''}`;
        } else {
          detail = JSON.stringify(raw, null, 2);
        }
      } catch {
        detail = String(raw);
      }
    }

    const item: ActionLogItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      timeStr,
      category,
      level,
      title,
      detail,
      raw,
    };

    this.items.push(item);
    if (this.items.length > this.maxItems) {
      this.items.shift();
    }
    this.emit();
  }

  /** Logs an AI action (tool call, turn, generation, subagent) */
  public ai(title: string, raw?: unknown, level: LogLevel = 'info') {
    this.log('ai', level, title, raw);
  }

  /** Logs a User action (timeline edits, selection, clicks, settings, prompt) */
  public user(title: string, raw?: unknown, level: LogLevel = 'info') {
    this.log('user', level, title, raw);
  }

  /** Logs a system / runtime event (IPC, worker status, FFmpeg, jobs) */
  public system(title: string, raw?: unknown, level: LogLevel = 'info') {
    this.log('system', level, title, raw);
  }

  /** Logs an error or warning */
  public error(title: string, raw?: unknown) {
    this.log('error', 'error', title, raw);
  }

  public warn(title: string, raw?: unknown) {
    this.log('system', 'warn', title, raw);
  }
}

export const actionLogger = new ActionLogger();
