// Catches what goes wrong in the interface and opens the crash report panel; also drives the small
// feedback card. Nothing is sent from here — the panel shows what a report holds and sends it only
// when the person presses Send (support.rs does the sending, the logs and the screenshot).
import { useSyncExternalStore } from 'react';
import { actionLogger } from './actionLogger';
import { api, type SupportScreenshot } from './ipc';

export type ErrorSource = 'react' | 'window' | 'promise' | 'console' | 'manual';

export type CapturedError = {
  source: ErrorSource;
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
  /** Which part of the app caught it (an error boundary's scope). */
  scope?: string;
  at: string;
  count: number;
  signature: string;
};

export type CrashDialog = {
  mode: 'crash' | 'previous_session' | 'manual';
  errors: CapturedError[];
  /** crash.log entries from the session that crashed (previous_session only). */
  previousCrash?: string;
  screenshot: SupportScreenshot | null;
  /** The capture failed; the panel says so rather than showing an empty frame. */
  screenshotError?: string;
};

export type FeedbackCard = { source: 'first_render' | 'settings' };

/** `hidden`: the panel steps aside for a new screenshot, keeping what was typed into it. */
type Snapshot = { dialog: CrashDialog | null; feedback: FeedbackCard | null; capturing: boolean; hidden: boolean };

const AUTO_SHOW_KEY = 'bhippi.support.autoShow';
const FIRST_RENDER_KEY = 'bhippi.feedback.firstRenderAsked';
/** After the panel is closed, another error waits this long before it may open it again. */
const COOLDOWN_MS = 90_000;
const MAX_ERRORS = 25;

let snapshot: Snapshot = { dialog: null, feedback: null, capturing: false, hidden: false };
const listeners = new Set<() => void>();
const errors = new Map<string, CapturedError>();
const counted = new WeakSet<Error>();
/** Signatures the panel already opened for this session: one popup per distinct problem. */
const shownFor = new Set<string>();
let quietUntil = 0;
let contextProvider: (() => Record<string, unknown>) | null = null;
let hardware: Promise<unknown> | null = null;
const startedAt = Date.now();

function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

function readFlag(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeFlag(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: lasts this session */
  }
}

// ───────────────────────────── describing an error ─────────────────────────────

const BUILD_NOISE = /(https?:\/\/(tauri\.localhost|localhost:\d+)|tauri:\/\/localhost|asset:\/\/localhost)/g;

function cleanStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  return stack.replace(BUILD_NOISE, '').replace(/\?(v|t|import)=[\w.&=-]+/g, '').split('\n').slice(0, 40).join('\n');
}

/** Same bug, same place → same signature, however the numbers and names inside the message vary. */
function signatureOf(name: string, message: string, stack?: string): string {
  const normalized = message
    .replace(/(["'`]).*?\1/g, '"…"')
    .replace(/\b[0-9a-f]{8,}\b/gi, '#')
    .replace(/\d+(\.\d+)?/g, 'N')
    .slice(0, 160);
  const frame = cleanStack(stack)
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('at ') || line.includes('@'));
  return `${name}: ${normalized}${frame ? ` @ ${frame.replace(/^at\s+/, '').slice(0, 140)}` : ''}`;
}

function describe(reason: unknown): { name: string; message: string; stack?: string } {
  if (reason instanceof Error) return { name: reason.name || 'Error', message: reason.message || String(reason), stack: reason.stack };
  if (typeof reason === 'string') return { name: 'Error', message: reason };
  try {
    return { name: 'Error', message: JSON.stringify(reason).slice(0, 2000) };
  } catch {
    return { name: 'Error', message: String(reason) };
  }
}

/** Browser noise that is not a Bhippi bug. */
function ignorable(message: string): boolean {
  return /ResizeObserver loop|AbortError|The operation was aborted|Script error\.?$|cancelled|canceled/i.test(message);
}

function remember(source: ErrorSource, reason: unknown, extra: { componentStack?: string; scope?: string } = {}): CapturedError | null {
  const { name, message, stack } = describe(reason);
  if (!message || ignorable(message)) return null;
  const signature = signatureOf(name, message, stack);
  const existing = errors.get(signature);
  // The same Error object reported twice (a boundary logs it to the console too) is one occurrence.
  const repeat = reason instanceof Error && counted.has(reason);
  if (reason instanceof Error) counted.add(reason);
  if (existing) {
    if (!repeat) existing.count += 1;
    if (existing.source === 'console' && source !== 'console') existing.source = source;
    existing.scope ??= extra.scope;
    existing.at = new Date().toISOString();
    if (!existing.componentStack && extra.componentStack) existing.componentStack = extra.componentStack;
    return existing;
  }
  const entry: CapturedError = {
    source,
    name,
    message: message.slice(0, 4000),
    stack: cleanStack(stack),
    componentStack: extra.componentStack?.split('\n').slice(0, 30).join('\n'),
    scope: extra.scope,
    at: new Date().toISOString(),
    count: 1,
    signature,
  };
  errors.set(signature, entry);
  if (errors.size > MAX_ERRORS) errors.delete(errors.keys().next().value as string);
  return entry;
}

// ───────────────────────────── the report ─────────────────────────────

/** The in-app Terminal as plain text: the actions leading up to the problem, oldest first. */
export function terminalLogText(limit = 400): string {
  const lines = actionLogger.getLogs().slice(-limit).map((item) => {
    const detail = item.detail ? ` — ${item.detail.replace(/\s+/g, ' ').slice(0, 700)}` : '';
    return `${item.timeStr} [${item.category}/${item.level}] ${item.title}${detail}`;
  });
  let text = lines.join('\n');
  if (text.length > 150_000) text = text.slice(text.length - 150_000);
  return text;
}

export async function reportContext(): Promise<Record<string, unknown>> {
  hardware ??= api.hardwareInfo().catch(() => null);
  let app: Record<string, unknown> = {};
  try {
    app = contextProvider?.() ?? {};
  } catch (error) {
    app = { contextError: String(error) };
  }
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  return {
    app,
    window: { width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio, focused: document.hasFocus() },
    sessionMinutes: Math.round((Date.now() - startedAt) / 60_000),
    language: navigator.language,
    userAgent: navigator.userAgent,
    heapMb: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
    heapLimitMb: memory ? Math.round(memory.jsHeapSizeLimit / 1048576) : null,
    hardware: await hardware,
  };
}

export function reportTitle(dialog: CrashDialog, description: string): string {
  const first = dialog.errors[0];
  if (dialog.mode === 'previous_session') {
    const payload = dialog.previousCrash?.match(/Payload: (.+)/)?.[1] ?? dialog.previousCrash?.match(/Frontend error: (.+)/)?.[1];
    return `Bhippi closed unexpectedly${payload ? `: ${payload}` : ''}`.slice(0, 200);
  }
  if (first) return `${first.scope ? `[${first.scope}] ` : ''}${first.name}: ${first.message}`.slice(0, 200);
  return description.trim().split('\n')[0].slice(0, 160) || 'Problem reported from Settings';
}

export function reportSignature(dialog: CrashDialog): string | null {
  if (dialog.errors[0]) return dialog.errors[0].signature;
  if (dialog.mode === 'previous_session') {
    const location = dialog.previousCrash?.match(/Location: (.+)/)?.[1];
    const payload = dialog.previousCrash?.match(/Payload: (.+)/)?.[1];
    return location || payload ? `panic: ${(payload ?? '').replace(/\d+/g, 'N').slice(0, 160)} @ ${location ?? '?'}` : null;
  }
  return null;
}

async function screenshot(): Promise<{ screenshot: SupportScreenshot | null; screenshotError?: string }> {
  try {
    return { screenshot: await api.supportScreenshot() };
  } catch (error) {
    return { screenshot: null, screenshotError: String(error) };
  }
}

/** Two frames and a beat, so whatever was just hidden is gone from the screen before the capture. */
const settle = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(resolve, 120))));

async function open(mode: CrashDialog['mode'], list: CapturedError[], previousCrash?: string, withShot = true) {
  if (snapshot.dialog || snapshot.capturing) {
    // Already showing: add what just happened to the open report.
    if (snapshot.dialog) publish({ dialog: { ...snapshot.dialog, errors: mergeErrors(snapshot.dialog.errors, list) } });
    return;
  }
  publish({ capturing: true });
  const shot = withShot ? await screenshot() : { screenshot: null };
  publish({ capturing: false, dialog: { mode, errors: list, previousCrash, ...shot } });
}

function mergeErrors(current: CapturedError[], added: CapturedError[]): CapturedError[] {
  const out = [...current];
  for (const entry of added) if (!out.some((item) => item.signature === entry.signature)) out.push(entry);
  return out;
}

function maybeOpen(entry: CapturedError | null) {
  if (!entry || !crashReporter.autoShow()) return;
  if (snapshot.dialog) {
    publish({ dialog: { ...snapshot.dialog, errors: mergeErrors(snapshot.dialog.errors, [entry]) } });
    return;
  }
  if (shownFor.has(entry.signature) || Date.now() < quietUntil) return;
  shownFor.add(entry.signature);
  void open('crash', [entry, ...[...errors.values()].filter((item) => item !== entry).slice(-5)]);
}

// ───────────────────────────── public ─────────────────────────────

export const crashReporter = {
  get: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** An error boundary caught a render crash. */
  reportBoundary(error: Error, componentStack: string, scope: string) {
    maybeOpen(remember('react', error, { componentStack, scope: scope || undefined }));
  },

  /** Opens the panel from Settings. `beforeCapture` hides what is on top first (Settings itself). */
  async openManual(beforeCapture?: () => void) {
    beforeCapture?.();
    await settle();
    await open('manual', [...errors.values()].slice(-10));
  },

  /** Shows the report for a crash found in crash.log from the last session. */
  openPreviousSession(text: string) {
    void open('previous_session', [], text, false);
  },

  /** Hides the panel, captures the window, and shows it again with the new picture. */
  async retakeScreenshot() {
    const dialog = snapshot.dialog;
    if (!dialog) return;
    publish({ hidden: true, capturing: true });
    await settle();
    const shot = await screenshot();
    publish({ hidden: false, capturing: false, dialog: { ...(snapshot.dialog ?? dialog), ...shot } });
  },

  close() {
    quietUntil = Date.now() + COOLDOWN_MS;
    publish({ dialog: null, hidden: false });
    // Whatever this session wrote to crash.log was just seen here; don't offer it again next launch.
    void api.supportNewCrashes().catch(() => undefined);
  },

  /** Every error caught this session, newest last. */
  errors: () => [...errors.values()],

  /** What the app is doing (project size, tool, selection), attached to every report. */
  setContextProvider(provider: (() => Record<string, unknown>) | null) {
    contextProvider = provider;
  },

  autoShow: () => readFlag(AUTO_SHOW_KEY) !== '0',
  setAutoShow(on: boolean) {
    writeFlag(AUTO_SHOW_KEY, on ? null : '0');
    publish({});
  },

  // ── feedback card ──
  /** The first finished export asks once how Bhippi is doing. */
  afterRender() {
    if (readFlag(FIRST_RENDER_KEY)) return;
    writeFlag(FIRST_RENDER_KEY, String(Date.now()));
    // Let the "Export complete" toast have its moment first.
    window.setTimeout(() => {
      if (!snapshot.feedback && !snapshot.dialog) publish({ feedback: { source: 'first_render' } });
    }, 5000);
  },
  openFeedback() {
    publish({ feedback: { source: 'settings' } });
  },
  closeFeedback() {
    publish({ feedback: null });
  },
};

export function useCrashReporter(): Snapshot {
  return useSyncExternalStore(crashReporter.subscribe, crashReporter.get);
}

// Uncaught errors open the panel. Rejected promises only do when they carry a real JS error: a
// rejected IPC call rejects with a plain message the caller already shows, so it is only recorded.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    maybeOpen(remember('window', event.error ?? event.message));
  });
  window.addEventListener('unhandledrejection', (event) => {
    const entry = remember('promise', event.reason);
    if (event.reason instanceof Error && event.reason.stack) maybeOpen(entry);
  });
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    const error = args.find((arg): arg is Error => arg instanceof Error);
    // Recorded for the report; console errors alone never open the panel.
    if (error) remember('console', error);
  };
}
