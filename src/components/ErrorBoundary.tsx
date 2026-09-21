// A crash must never leave a black window: it shows what went wrong, and lets the editor carry on.
import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null; info: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The console entry is what shows up in the webview's log and in bug reports.
    console.error('Helios hit an error', error, info.componentStack);
    this.setState({ info: (info.componentStack ?? '').split('\n').slice(0, 6).join('\n') });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-card">
          <h1>Helios hit an error</h1>
          <p>Your project is autosaved, so nothing is lost. Try again — and if it keeps happening, send this message along.</p>
          <pre>{error.message}{info ? `\n${info}` : ''}</pre>
          <div className="crash-actions">
            <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null, info: '' })}>Try again</button>
            <button type="button" className="btn" onClick={() => window.location.reload()}>Reload Helios</button>
          </div>
        </div>
      </div>
    );
  }
}
