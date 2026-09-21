import type { Settings } from './types';

export type Theme = 'default' | 'minimal';

/** The active color theme: only an explicit 'minimal' choice changes the look. */
export function resolveTheme(settings: Pick<Settings, 'theme'> | null | undefined): Theme {
  return settings?.theme === 'minimal' ? 'minimal' : 'default';
}

/** Applies the theme to the document root so `:root[data-theme=…]` rules take over. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
