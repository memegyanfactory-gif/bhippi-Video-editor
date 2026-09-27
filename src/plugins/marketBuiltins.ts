// Plugins Bhippi ships, listed in the marketplace beside the published ones: Characters. They are
// part of the app — already "installed", opened with Open, never downloaded — so they carry no
// version, reviews or report form, and the store shows them as Built in.

import type { MarketPlugin } from './market';

/** The Characters tab's id (characters/CharactersWindow.tsx CHARACTERS_TAB). */
const CHARACTERS_TAB = 'builtin-characters';

export type BuiltinListing = MarketPlugin & { builtin: true; tagline: string; about: string };

export const BHIPPI_PUBLISHER = { handle: 'bhippi', name: 'Bhippi', verified: true, picture: 'bhippi.png' } as const;

export const BUILTIN_LISTINGS: BuiltinListing[] = [
  {
    builtin: true,
    id: CHARACTERS_TAB,
    name: 'Characters',
    tagline: 'Make 2D and 3D characters for your videos.',
    summary: 'Make 2D and 3D characters for your videos.',
    about: 'Build a cast for this project: design a 2D or 3D character, pose it, give it moves and expressions, and add it to your timeline as a clip that animates with your edit.',
    icon: null,
    logo: 'characters/character-plugin-icon.png',
    category: 'motion',
    author: 'Bhippi',
    publisher: BHIPPI_PUBLISHER,
    version: null,
    bhippi: null,
    size: null,
    updatedAt: 0,
    installs: 0,
    rating: null,
    permissions: { tools: [], network: [], chat: false },
    background: false,
  },
];

export const isBuiltin = (plugin: MarketPlugin): plugin is BuiltinListing => (plugin as Partial<BuiltinListing>).builtin === true;
