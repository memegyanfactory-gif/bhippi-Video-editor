// Organize keeps the window's menu bar across the top (components/OverviewShell.tsx), but the
// menus belong to a project: the one last clicked sends them over as plain data, and a pick is
// sent back to it by id. The functions stay in the project's page; only labels travel.
import type { MenuGroup } from '../components/AppChrome';
import type { MenuItem } from '../components/workspace';

/** A project → the bar: its menus. */
export const SHELL_MENUS_EVENT = 'bhippi://shell-menus';
/** The bar → the project: run the item with this id. */
export const SHELL_INVOKE_EVENT = 'bhippi://shell-invoke';
/** The bar → every project: send the menus again (the bar has just opened). */
export const SHELL_ASK_EVENT = 'bhippi://shell-ask';

export type ShellItem =
  | { separator: true }
  | { id: string; label: string; shortcut?: string; disabled?: boolean; checked?: boolean; submenu?: ShellItem[] };

export type ShellMenus = {
  /** The webview that sent them: picks go back there. */
  from: string;
  /** Its project's name, shown in the bar. */
  project: string;
  groups: { label: string; items: ShellItem[] }[];
};

/** Menus as plain data, and each item's function by the id it travels under. */
export function packShellMenus(menus: MenuGroup[], project: string, from = ''): { payload: ShellMenus; handlers: Map<string, () => void> } {
  const handlers = new Map<string, () => void>();
  const pack = (items: MenuItem[], path: string): ShellItem[] =>
    items.map((item, index) => {
      if ('separator' in item) return { separator: true };
      const id = `${path}.${index}`;
      if (item.onSelect) handlers.set(id, item.onSelect);
      return {
        id,
        label: item.label,
        ...(item.shortcut ? { shortcut: item.shortcut } : {}),
        ...(item.disabled ? { disabled: true } : {}),
        ...(item.checked !== undefined ? { checked: item.checked } : {}),
        ...(item.submenu ? { submenu: pack(item.submenu, id) } : {}),
      };
    });
  return { payload: { from, project, groups: menus.map((group, index) => ({ label: group.label, items: pack(group.items, String(index)) })) }, handlers };
}

/** The bar's menus: each pick sends its id back to the project that sent them. */
export function unpackShellMenus(menus: ShellMenus, pick: (id: string) => void): MenuGroup[] {
  const unpack = (items: ShellItem[]): MenuItem[] =>
    items.map((item) => ('separator' in item ? { separator: true } : { label: item.label, shortcut: item.shortcut, disabled: item.disabled, checked: item.checked, onSelect: () => pick(item.id), ...(item.submenu ? { submenu: unpack(item.submenu) } : {}) }));
  return menus.groups.map((group) => ({ label: group.label, items: unpack(group.items) }));
}
