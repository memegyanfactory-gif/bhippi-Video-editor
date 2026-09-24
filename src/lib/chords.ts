// Which editor command a modifier chord (Ctrl, Alt, Shift with a key) asks for. App.tsx carries
// the command out; the reading lives here, apart from React, so the order the chords are matched
// in can be tested — a broad `Ctrl+X` checked before `Ctrl+Shift+X` once cut clips when the user
// meant to clear In and Out.

export type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

export type Chord =
  | 'newProject' | 'newComp' | 'open' | 'saveCopy' | 'saveAs' | 'save' | 'import' | 'exportFrame' | 'export' | 'quit' | 'newFolder' | 'shortcuts' | 'toggleChat' | 'settings' | 'find' | 'fxConsole'
  | 'undo' | 'redo' | 'pasteAttributes' | 'pasteInsert' | 'paste' | 'copy' | 'cut' | 'deselectAll' | 'selectAll' | 'editOriginal'
  | 'speed' | 'ungroup' | 'group' | 'link' | 'addEditAll' | 'addEdit' | 'applyTransition' | 'newTitle' | 'rectangle' | 'ellipse' | 'duplicate'
  | 'clearIn' | 'clearOut' | 'clearInOut' | 'clearAllMarkers' | 'clearMarker' | 'previousMarker'
  | 'videoTaller' | 'videoShorter' | 'audioTaller' | 'audioShorter' | 'allTaller' | 'allShorter'
  | `panel${number}`;

/** Chords that work on the home screen too; every other one needs an open project. */
export const APP_CHORDS: ReadonlySet<Chord> = new Set<Chord>(['newProject', 'newComp', 'open', 'saveCopy', 'saveAs', 'save', 'import', 'exportFrame', 'export', 'quit', 'newFolder', 'shortcuts', 'toggleChat', 'settings', 'find', 'fxConsole']);

/**
 * The command for a key event, or null when it is not a modifier chord of the editor.
 *
 * A plain-Ctrl letter that shares its key with a longer chord says it wants no Shift or Alt.
 * Shifted digits and the slash are read from `code`: with Shift held, `key` is the shifted
 * character ('#', '?'), which differs from layout to layout.
 */
export function chordAction(event: KeyLike): Chord | null {
  const ctrl = event.ctrlKey || event.metaKey;
  const shift = event.shiftKey;
  const alt = event.altKey;
  const key = event.key.toLowerCase();
  // File and app-wide
  if (ctrl && alt && key === 'n') return 'newProject';
  if (ctrl && !alt && key === 'n') return 'newComp';
  if (ctrl && !shift && !alt && key === 'o') return 'open';
  if (ctrl && alt && key === 's') return 'saveCopy';
  if (ctrl && shift && key === 's') return 'saveAs';
  if (ctrl && key === 's') return 'save';
  if (ctrl && !shift && !alt && key === 'i') return 'import';
  if (ctrl && shift && key === 'e') return 'exportFrame';
  if (ctrl && !shift && !alt && key === 'm') return 'export';
  if (ctrl && key === 'q') return 'quit';
  if (ctrl && shift && event.code === 'Slash') return 'duplicate';
  if (ctrl && !shift && key === '/') return 'newFolder';
  if (ctrl && alt && key === 'k') return 'shortcuts';
  if (ctrl && alt && key === 'l') return 'toggleChat';
  if (ctrl && key === ',') return 'settings';
  if (ctrl && key === 'f') return 'find';
  if (ctrl && (key === ' ' || event.code === 'Space')) return 'fxConsole';
  // Edit
  if (ctrl && key === 'z') return shift ? 'redo' : 'undo';
  if (ctrl && key === 'y') return 'redo';
  if (ctrl && alt && key === 'v') return 'pasteAttributes';
  if (ctrl && shift && key === 'v') return 'pasteInsert';
  if (ctrl && key === 'v') return 'paste';
  if (ctrl && key === 'c') return 'copy';
  if (ctrl && !shift && !alt && key === 'x') return 'cut';
  if (ctrl && shift && key === 'a') return 'deselectAll';
  if (ctrl && key === 'a') return 'selectAll';
  if (ctrl && !shift && !alt && key === 'e') return 'editOriginal';
  // Clip and comp
  if (ctrl && !shift && !alt && key === 'r') return 'speed';
  if (ctrl && shift && key === 'g') return 'ungroup';
  if (ctrl && key === 'g') return 'group';
  if (ctrl && key === 'l') return 'link';
  if (ctrl && shift && key === 'k') return 'addEditAll';
  if (ctrl && key === 'k') return 'addEdit';
  if (ctrl && key === 'd') return 'applyTransition';
  if (ctrl && key === 't') return 'newTitle';
  if (ctrl && alt && key === 'r') return 'rectangle';
  if (ctrl && alt && key === 'e') return 'ellipse';
  // Markers
  if (ctrl && shift && key === 'i') return 'clearIn';
  if (ctrl && shift && key === 'o') return 'clearOut';
  if (ctrl && shift && key === 'x') return 'clearInOut';
  if (ctrl && alt && shift && key === 'm') return 'clearAllMarkers';
  if (ctrl && alt && key === 'm') return 'clearMarker';
  if (ctrl && shift && key === 'm') return 'previousMarker';
  // Track heights and panels
  if (ctrl && (key === '=' || key === '+')) return 'videoTaller';
  if (ctrl && key === '-') return 'videoShorter';
  if (alt && (key === '=' || key === '+')) return 'audioTaller';
  if (alt && key === '-') return 'audioShorter';
  if (shift && (key === '=' || key === '+')) return 'allTaller';
  if (shift && key === '_') return 'allShorter';
  if (shift && !ctrl && !alt && /^Digit[1-8]$/.test(event.code)) return `panel${Number(event.code.slice(5))}`;
  return null;
}
