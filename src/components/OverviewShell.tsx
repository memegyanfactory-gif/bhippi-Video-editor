// Organize's bar across the top of Bhippi's window (tabs.rs lays every open project out as a tile
// below it): the window's own menu bar, as it is outside Organize. File, Edit, Window… run on the
// project last clicked (it sends its menus here, lib/shellMenus.ts), and the window's minimize,
// maximize and close stay where they always are. It is a small page of its own
// (index.html?view=overview), so it never loads an editor. A pick goes to that project's webview
// by name ({kind: 'Webview'}): the first project is called "main" like the window, and a bare
// "main" would reach every project.
import { emit, emitTo, listen } from '@tauri-apps/api/event';
import { LayoutGrid } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, events } from '../lib/ipc';
import { SHELL_ASK_EVENT, SHELL_INVOKE_EVENT, SHELL_MENUS_EVENT, unpackShellMenus, type ShellMenus } from '../lib/shellMenus';
import type { TabsState } from '../lib/types';
import { MenuBar } from './AppChrome';

export function OverviewShell() {
  const [tabs, setTabs] = useState<TabsState | null>(null);
  const [menus, setMenus] = useState<ShellMenus | null>(null);
  useEffect(() => {
    void api.tabsList().then(setTabs).catch(() => undefined);
    const subscriptions = [events.tabs(setTabs), listen<ShellMenus>(SHELL_MENUS_EVENT, (event) => setMenus(event.payload))];
    // The project on screen sends its menus once it hears the bar is here.
    void emit(SHELL_ASK_EVENT).catch(() => undefined);
    return () => subscriptions.forEach((pending) => void pending.then((unlisten) => unlisten()));
  }, []);
  const groups = menus ? unpackShellMenus(menus, (id) => void emitTo({ kind: 'Webview', label: menus.from }, SHELL_INVOKE_EVENT, id).catch(() => undefined)) : [];
  const count = tabs?.tabs.length ?? 0;
  return (
    <div className="overview-shell">
      <MenuBar
        menus={groups}
        onClose={() => void api.appQuit().catch(() => undefined)}
        extra={
          <div className="overview-shell-extra">
            <span className="muted">{count} projects{menus ? ` · menus act on “${menus.project}”` : ''}</span>
            <button type="button" className="overview-shell-back" onClick={() => void api.overviewSet(false, tabs?.active ?? null)} title="Back to the project last clicked (Ctrl+Alt+O)">
              <LayoutGrid size={13} /> Back to projects
            </button>
          </div>
        }
      />
    </div>
  );
}
