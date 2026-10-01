import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The menu bar asks Tauri for its window when it draws; outside the app there is none.
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() }) }));

const { MenuBar } = await import('../src/components/AppChrome');
const { WindowControls } = await import('../src/components/WindowControls');

const icons = (html: string) => [...html.matchAll(/<svg[^>]*class="lucide[^"]*"[^>]*>.*?<\/svg>/g)].map((match) => match[0]);

describe('the window’s own controls, laid over the menu bar’s buttons', () => {
  it('are the menu bar’s three buttons, in its order, with the same icons at the same sizes', () => {
    // The page is see-through over the menu bar: its hover draws its icon exactly on the one below.
    const bar = renderToStaticMarkup(createElement(MenuBar, { menus: [] }));
    const own = renderToStaticMarkup(createElement(WindowControls));
    const barButtons = bar.slice(bar.indexOf('win-controls'));
    expect(icons(own)).toHaveLength(3);
    expect(icons(own)).toEqual(icons(barButtons));
    expect([...own.matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1])).toEqual(['Minimize', 'Maximize', 'Close']);
  });

  it('never take the keyboard: no button is reachable by Tab', () => {
    const own = renderToStaticMarkup(createElement(WindowControls));
    expect(own.match(/tabindex="-1"/g)).toHaveLength(3);
  });
});
