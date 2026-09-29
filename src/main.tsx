import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SupportLayer } from './components/SupportLayer';
import { ToastProvider } from './components/ui';
import { LicenseGate } from './license/LicenseGate';
import './fonts/bundled.css';
import './fonts/fiwn.css';
import './styles/app.css';
import './styles/color.css';
import './styles/themes.css';
import './styles/terminal.css';
import './styles/brandkit.css';
import './styles/license.css';
// Last, so the composer's rules win over the older ones in app.css.
import './styles/composer.css';

// A desktop app has no use for the browser's own context menu (Back, Reload, Inspect) — except
// when the user has text selected, where that menu's "Copy" is the only right-click way to grab
// it (chat, settings, anywhere else text is selectable, none of which have their own menu).
window.addEventListener('contextmenu', (event) => {
  const selection = window.getSelection();
  const hasTextSelection = !!selection && !selection.isCollapsed && selection.toString().length > 0;
  if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) && !hasTextSelection) {
    event.preventDefault();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <LicenseGate>
          <App />
        </LicenseGate>
      </ToastProvider>
    </ErrorBoundary>
    {/* Outside the boundary: the crash report panel still opens when the editor itself has crashed. */}
    <SupportLayer />
  </StrictMode>,
);
