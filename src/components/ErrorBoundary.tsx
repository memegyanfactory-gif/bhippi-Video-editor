// A crash must never leave a black window: it shows what went wrong, and lets the editor carry on.
// Every caught crash is also written to crash.log (beside Rust panics) and kept for the next
// launch, so an error that a reload clears can still be read and fixed.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { api } from '../lib/ipc';
import { crashReporter } from '../lib/crashReporter';

type Props = {
  children: ReactNode;
  /** A scoped boundary (one panel or layer): shows a compact inline notice instead of the full screen. */
  scope?: string;
};
type State = { error: Error | null; info: string };

const LAST_CRASH = 'bhippi.lastCrash';

/** The crash the previous session hit, if any (read once, then forgotten). */
export function takeLastCrash(): { at: string; message: string; scope: string } | null {
  try {
    const raw = localStorage.getItem(LAST_CRASH);
    if (!raw) return null;
    localStorage.removeItem(LAST_CRASH);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function record(error: Error, components: string, scope: string) {
  const message = `${scope ? `[${scope}] ` : ''}${error.message}`;
  try { localStorage.setItem(LAST_CRASH, JSON.stringify({ at: new Date().toISOString(), message, scope })); } catch { /* storage full or blocked */ }
  void api.frontendCrash(message, error.stack ?? '', components).catch(() => undefined);
  // Opens the crash report panel (once per distinct problem, unless turned off in Settings).
  crashReporter.reportBoundary(error, components, scope);
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The console entry is what shows up in the webview's log and in bug reports.
    console.error('Bhippi hit an error', error, info.componentStack);
    record(error, info.componentStack ?? '', this.props.scope ?? '');
    this.setState({ info: (info.componentStack ?? '').split('\n').slice(0, 6).join('\n') });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    if (this.props.scope) {
      return (
        <div className="scoped-crash" role="alert">
          <strong>{this.props.scope} hit an error.</strong> <span>{error.message}</span>{' '}
          <button type="button" className="btn btn-small" onClick={() => this.setState({ error: null, info: '' })}>Try again</button>
        </div>
      );
    }
    return (
      <div className="crash">
        <div className="crash-card">
          <h1><img src="/bhippi.png" alt="" width={22} height={22} /> Bhippi hit an error</h1>
          <p>Your project is autosaved, so nothing is lost. Try again — or send a report so we can fix it. The details are also saved to crash.log in the Bhippi data folder.</p>
          <pre>{error.message}{info ? `\n${info}` : ''}</pre>
          <div className="crash-actions">
            <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null, info: '' })}>Try again</button>
            <button type="button" className="btn" onClick={() => void crashReporter.openManual()}>Send a report</button>
            <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(`${error.message}\n${error.stack ?? ''}\n${info}`)}>Copy details</button>
            <button type="button" className="btn" onClick={() => window.location.reload()}>Reload Bhippi</button>
          </div>
        </div>
      </div>
    );
  }
}
