import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { BootSplash } from './boot/BootSplash';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SupportLayer } from './components/SupportLayer';
import { ToastProvider } from './components/ui';
import { LicenseGate } from './license/LicenseGate';
import { OverviewShell } from './components/OverviewShell';
import { isCaptureView, isOverviewBar, isTabView } from './lib/projectView';
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

/**
 * The launch splash belongs to launching Bhippi. A project tab (tabs.rs) is opened from inside
 * Bhippi and stays hidden until its project is in, so it has no splash: it starts as the editor,
 * solid, the way the first project is once its splash has gone. The overview's bar is only a bar.
 */
if (isTabView || isOverviewBar || isCaptureView) document.documentElement.classList.remove('booting');

createRoot(document.getElementById('root')!).render(
  isOverviewBar ? (
    <StrictMode>
      <OverviewShell />
    </StrictMode>
  ) : (
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <LicenseGate>
          <App />
        </LicenseGate>
        {!isTabView && !isCaptureView && <BootSplash />}
      </ToastProvider>
    </ErrorBoundary>
    {/* Outside the boundary: the crash report panel still opens when the editor itself has crashed. */}
    <SupportLayer />
  </StrictMode>
  ),
);
