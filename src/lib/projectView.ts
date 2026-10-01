// Which view of Bhippi this page is. Every open project is a webview of its own inside Bhippi's
// one window (src-tauri/src/tabs.rs): the first is "main", every other project tab is
// "tab-<id>", and the overview's bar across the top is "overview". The window's label is "main"
// for all of them, so a page tells itself apart by its webview's label.
import { getCurrentWebview } from '@tauri-apps/api/webview';

/** This page's webview label ("main" outside the app, in tests). */
export const ownLabel: string = (() => {
  try {
    return getCurrentWebview().label;
  } catch {
    return 'main';
  }
})();

/** A project tab opened from inside Bhippi (not the first project, which opens with the app). */
export const isTabView = ownLabel.startsWith('tab-');

/**
 * Bhippi filmed by capture_app_session / record_app_scene (app_capture.rs loads it with
 * ?capture=1 in a headless browser): it opens straight on the editor, with no launch splash and
 * no Home screen, so the parts a film asks for (@timeline, @composer…) are on the page.
 */
export const isCaptureView = (() => {
  try {
    return new URLSearchParams(window.location.search).get('capture') === '1';
  } catch {
    return false;
  }
})();

/** The overview's bar (tabs.rs loads it with ?view=overview). */
export const isOverviewBar = (() => {
  try {
    return new URLSearchParams(window.location.search).get('view') === 'overview';
  } catch {
    return false;
  }
})();
