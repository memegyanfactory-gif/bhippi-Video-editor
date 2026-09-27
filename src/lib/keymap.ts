// The editor's keyboard commands and the keys that run them. Every shortcut is a command here with
// its default keys (Premiere Pro's Windows layout, as Bhippi implements it); the user can change
// any of them in Keyboard Shortcuts, and only what they changed is saved (Settings.shortcuts).
// App.tsx carries the commands out.
//
// A key is written the same way everywhere: modifiers in the order Ctrl, Alt, Shift, then the
// physical key ("Ctrl+Shift+S", "Shift+Left", "Space", "Num+"). Keys are read from `code`, so a
// shortcut is the same key whatever the keyboard layout types on it.

export type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

export type CommandGroup = 'File' | 'Edit' | 'Tools' | 'Playback' | 'Marking' | 'Editing' | 'Timeline' | 'Panels';

export type Command = {
  id: string;
  label: string;
  group: CommandGroup;
  keys: string[];
  /** Works on the home screen too; every other command needs an open project. */
  app?: boolean;
};

const command = (group: CommandGroup, id: string, label: string, keys: string[], app = false): Command => ({ id, label, group, keys, ...(app ? { app } : {}) });

export const COMMANDS: Command[] = [
  command('File', 'newProject', 'New project', ['Ctrl+Alt+N'], true),
  command('File', 'newComp', 'New comp', ['Ctrl+N'], true),
  command('File', 'open', 'Open project', ['Ctrl+O'], true),
  command('File', 'save', 'Save', ['Ctrl+S'], true),
  command('File', 'saveAs', 'Save as', ['Ctrl+Shift+S'], true),
  command('File', 'saveCopy', 'Save a copy', ['Ctrl+Alt+S'], true),
  command('File', 'import', 'Import media', ['Ctrl+I'], true),
  command('File', 'export', 'Export media', ['Ctrl+M'], true),
  command('File', 'exportFrame', 'Export frame', ['Ctrl+Shift+E'], true),
  command('File', 'newFolder', 'New folder', ['Ctrl+/'], true),
  command('File', 'quit', 'Quit', ['Ctrl+Q'], true),
  command('File', 'shortcuts', 'Keyboard shortcuts', ['Ctrl+Alt+K'], true),
  command('File', 'settings', 'Settings', ['Ctrl+,'], true),
  command('File', 'find', 'Find in the Project panel', ['Ctrl+F'], true),
  command('File', 'toggleChat', 'Show or hide Bhippi AI', ['Ctrl+Alt+L'], true),
  command('File', 'fxConsole', 'FX console', ['Ctrl+Space'], true),

  command('Edit', 'undo', 'Undo', ['Ctrl+Z']),
  command('Edit', 'redo', 'Redo', ['Ctrl+Shift+Z', 'Ctrl+Y']),
  command('Edit', 'cut', 'Cut', ['Ctrl+X']),
  command('Edit', 'copy', 'Copy', ['Ctrl+C']),
  command('Edit', 'paste', 'Paste at the playhead', ['Ctrl+V']),
  command('Edit', 'pasteInsert', 'Paste insert', ['Ctrl+Shift+V']),
  command('Edit', 'pasteAttributes', 'Paste attributes', ['Ctrl+Alt+V']),
  command('Edit', 'clear', 'Clear', ['Delete', 'Backspace']),
  command('Edit', 'rippleDelete', 'Ripple delete', ['Shift+Delete', 'Shift+Backspace']),
  command('Edit', 'duplicate', 'Duplicate', ['Ctrl+Shift+/']),
  command('Edit', 'selectAll', 'Select all', ['Ctrl+A']),
  command('Edit', 'deselectAll', 'Deselect all', ['Ctrl+Shift+A']),
  command('Edit', 'editOriginal', 'Edit original', ['Ctrl+E']),

  command('Tools', 'toolSelect', 'Selection tool', ['V']),
  command('Tools', 'toolTrackForward', 'Track select forward', ['A']),
  command('Tools', 'toolTrackBackward', 'Track select backward', ['Shift+A']),
  command('Tools', 'toolRipple', 'Ripple edit tool', ['B']),
  command('Tools', 'toolRolling', 'Rolling edit tool', ['N']),
  command('Tools', 'toolRateStretch', 'Rate stretch tool', ['R']),
  command('Tools', 'toolRazor', 'Razor tool', ['C']),
  command('Tools', 'toolSlip', 'Slip tool', ['Y']),
  command('Tools', 'toolSlide', 'Slide tool', ['U']),
  command('Tools', 'toolPen', 'Pen tool (keyframes and pen masks)', ['P']),
  command('Tools', 'toolHand', 'Hand tool', ['H']),
  command('Tools', 'toolZoom', 'Zoom tool', ['Z']),
  command('Tools', 'toolType', 'Type tool', ['T']),
  command('Tools', 'rectangle', 'Rectangle tool', ['Ctrl+Alt+R']),
  command('Tools', 'ellipse', 'Ellipse tool', ['Ctrl+Alt+E']),
  command('Tools', 'newTitle', 'New title', ['Ctrl+T']),

  command('Playback', 'playToggle', 'Play / stop the focused monitor', ['Space']),
  command('Playback', 'shuttleBack', 'Shuttle back (again for 2×, 4×, 8×)', ['J']),
  command('Playback', 'shuttleStop', 'Stop', ['K']),
  command('Playback', 'shuttleForward', 'Shuttle forward (again for 2×, 4×, 8×)', ['L']),
  command('Playback', 'playAround', 'Play around the playhead', ['Shift+K']),
  command('Playback', 'playInToOut', 'Play In to Out', ['Ctrl+Shift+Space']),
  command('Playback', 'stepBack', 'Step back one frame', ['Left']),
  command('Playback', 'stepForward', 'Step forward one frame', ['Right']),
  command('Playback', 'stepBack5', 'Step back five frames', ['Shift+Left']),
  command('Playback', 'stepForward5', 'Step forward five frames', ['Shift+Right']),
  command('Playback', 'previousEdit', 'Previous edit point (targeted tracks)', ['Up']),
  command('Playback', 'nextEdit', 'Next edit point (targeted tracks)', ['Down']),
  command('Playback', 'previousEditAny', 'Previous edit point (any track)', ['Shift+Up']),
  command('Playback', 'nextEditAny', 'Next edit point (any track)', ['Shift+Down']),
  command('Playback', 'goStart', 'Go to the comp start', ['Home']),
  command('Playback', 'goEnd', 'Go to the comp end', ['End']),
  command('Playback', 'jumpBack', 'Jump back five seconds', ['PageUp']),
  command('Playback', 'jumpForward', 'Jump forward five seconds', ['PageDown']),

  command('Marking', 'markIn', 'Mark In', ['I']),
  command('Marking', 'markOut', 'Mark Out', ['O']),
  command('Marking', 'markClip', 'Mark clip', ['X']),
  command('Marking', 'markSelection', 'Mark selection', ['/']),
  command('Marking', 'goIn', 'Go to In', ['Shift+I']),
  command('Marking', 'goOut', 'Go to Out', ['Shift+O']),
  command('Marking', 'clearIn', 'Clear In', ['Ctrl+Shift+I']),
  command('Marking', 'clearOut', 'Clear Out', ['Ctrl+Shift+O']),
  command('Marking', 'clearInOut', 'Clear In and Out', ['Ctrl+Shift+X']),
  command('Marking', 'addMarker', 'Add or remove marker', ['M']),
  command('Marking', 'nextMarker', 'Next marker', ['Shift+M']),
  command('Marking', 'previousMarker', 'Previous marker', ['Ctrl+Shift+M']),
  command('Marking', 'clearMarker', 'Clear the marker at the playhead', ['Ctrl+Alt+M']),
  command('Marking', 'clearAllMarkers', 'Clear all markers', ['Ctrl+Alt+Shift+M']),

  command('Editing', 'insert', 'Insert from the Source monitor', [',']),
  command('Editing', 'overwrite', 'Overwrite from the Source monitor', ['.']),
  command('Editing', 'addEdit', 'Add edit on targeted tracks', ['Ctrl+K']),
  command('Editing', 'addEditAll', 'Add edit on every track', ['Ctrl+Shift+K']),
  command('Editing', 'rippleTrimPrevious', 'Ripple trim previous edit to the playhead', ['Q']),
  command('Editing', 'rippleTrimNext', 'Ripple trim next edit to the playhead', ['W']),
  command('Editing', 'extendPrevious', 'Extend previous edit to the playhead', ['Shift+Q']),
  command('Editing', 'extendNext', 'Extend next edit to the playhead', ['Shift+W', 'E']),
  command('Editing', 'lift', 'Lift the In to Out range', [';']),
  command('Editing', 'extract', 'Extract the In to Out range', ["'"]),
  command('Editing', 'applyTransition', 'Apply the default transitions', ['Ctrl+D', 'Ctrl+Shift+D']),
  command('Editing', 'speed', 'Speed / Duration', ['Ctrl+R']),
  command('Editing', 'enableToggle', 'Enable or disable clips', ['Shift+E']),
  command('Editing', 'link', 'Link or unlink audio and video', ['Ctrl+L']),
  command('Editing', 'group', 'Group', ['Ctrl+G']),
  command('Editing', 'ungroup', 'Ungroup', ['Ctrl+Shift+G']),
  command('Editing', 'gain', 'Audio gain', ['G', 'Shift+G']),
  command('Editing', 'matchFrame', 'Match frame', ['F', 'Shift+R']),
  command('Editing', 'nudgeLeft', 'Nudge the selection one frame left', ['Alt+Left']),
  command('Editing', 'nudgeRight', 'Nudge the selection one frame right', ['Alt+Right']),
  command('Editing', 'nudgeLeft5', 'Nudge the selection five frames left', ['Alt+Shift+Left']),
  command('Editing', 'nudgeRight5', 'Nudge the selection five frames right', ['Alt+Shift+Right']),
  command('Editing', 'nudgeUp', 'Nudge the selection one track up', ['Alt+Up']),
  command('Editing', 'nudgeDown', 'Nudge the selection one track down', ['Alt+Down']),
  command('Editing', 'volumeDown', 'Clip volume down 1 dB', ['[']),
  command('Editing', 'volumeUp', 'Clip volume up 1 dB', [']']),
  command('Editing', 'volumeDown6', 'Clip volume down 6 dB', ['Shift+[']),
  command('Editing', 'volumeUp6', 'Clip volume up 6 dB', ['Shift+]']),

  command('Timeline', 'snap', 'Snap in timeline', ['S']),
  command('Timeline', 'zoomIn', 'Zoom in', ['=', 'Num+']),
  command('Timeline', 'zoomOut', 'Zoom out', ['-', 'Num-']),
  command('Timeline', 'zoomFit', 'Zoom to the whole comp (again to go back)', ['\\']),
  command('Timeline', 'allTaller', 'Expand all tracks', ['Shift+=']),
  command('Timeline', 'allShorter', 'Minimize all tracks', ['Shift+-']),
  command('Timeline', 'videoTaller', 'Taller video tracks', ['Ctrl+=', 'Ctrl+Num+']),
  command('Timeline', 'videoShorter', 'Shorter video tracks', ['Ctrl+-', 'Ctrl+Num-']),
  command('Timeline', 'audioTaller', 'Taller audio tracks', ['Alt+=', 'Alt+Num+']),
  command('Timeline', 'audioShorter', 'Shorter audio tracks', ['Alt+-', 'Alt+Num-']),

  command('Panels', 'panel1', 'Project panel', ['Shift+1']),
  command('Panels', 'panel2', 'Source monitor', ['Shift+2']),
  command('Panels', 'panel3', 'Timeline', ['Shift+3']),
  command('Panels', 'panel4', 'Program monitor', ['Shift+4']),
  command('Panels', 'panel5', 'Properties', ['Shift+5']),
  command('Panels', 'panel6', 'Audio meters', ['Shift+6']),
  command('Panels', 'panel7', 'Tools', ['Shift+7']),
  command('Panels', 'panel8', 'Transcription', ['Shift+8']),
  command('Panels', 'maximize', 'Maximize the panel under the cursor (or the focused one)', ['`', 'Shift+`']),
  command('Panels', 'escape', 'Deselect and go back to the Selection tool', ['Escape']),
];

export const COMMAND_IDS: ReadonlySet<string> = new Set(COMMANDS.map((item) => item.id));
export const findCommand = (id: string) => COMMANDS.find((item) => item.id === id);

/** Mouse gestures that go with the keys; shown in the dialog, not changeable. */
export const GESTURES: [string, string, CommandGroup][] = [
  ['Alt + drag a clip edge', 'Stretch or squish the clip (rate stretch)', 'Editing'],
  ['Ctrl + drag a clip edge', 'Ripple trim', 'Editing'],
  ['Ctrl+Shift + drag a clip edge', 'Rolling edit', 'Editing'],
  ['Alt + drag a clip', 'Duplicate it', 'Editing'],
  ['Ctrl + drop a clip', 'Insert instead of overwrite', 'Editing'],
  ['Alt + click a clip', 'Select it without its linked partner', 'Editing'],
  ['Ctrl + click a rubber band', 'Add a keyframe', 'Editing'],
  ['Alt + wheel', 'Zoom around the pointer', 'Timeline'],
  ['Shift + wheel', 'Scroll sideways', 'Timeline'],
];

const CODE_NAMES: Record<string, string> = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', IntlBackslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backquote: '`', Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab',
  Escape: 'Escape', Delete: 'Delete', Backspace: 'Backspace', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  NumpadAdd: 'Num+', NumpadSubtract: 'Num-', NumpadMultiply: 'Num*', NumpadDivide: 'Num/', NumpadDecimal: 'Num.',
};
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS', 'ContextMenu']);

/** The key a press names ("S", "Left", "Num+"), or null for a modifier on its own. */
function keyName(event: KeyLike): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const code = event.code ?? '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num${code.slice(6)}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  if (CODE_NAMES[code]) return CODE_NAMES[code];
  // No physical code (some virtual keyboards): the character itself.
  const key = event.key;
  if (key === ' ') return 'Space';
  if (key.startsWith('Arrow')) return key.slice(5);
  return key.length === 1 ? key.toUpperCase() : key || null;
}

/** A key press as a binding ("Ctrl+Shift+S"), or null for a modifier pressed on its own. */
export function bindingOf(event: KeyLike): string | null {
  const key = keyName(event);
  if (!key) return null;
  return `${event.ctrlKey || event.metaKey ? 'Ctrl+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''}${key}`;
}

/** A binding in the canonical order, whatever order it was written in ("shift+ctrl+s" → "Ctrl+Shift+S"). */
export function normalizeBinding(binding: string): string | null {
  const parts = binding.split('+').map((part) => part.trim());
  // "Num+" and "Ctrl++" style keys: an empty part at the end is the plus key itself.
  const key = parts[parts.length - 1] === '' ? (parts[parts.length - 2]?.toLowerCase() === 'num' ? 'Num+' : '=') : parts[parts.length - 1];
  const mods = new Set(parts.slice(0, key === 'Num+' ? -2 : parts[parts.length - 1] === '' ? -2 : -1).map((part) => part.toLowerCase()));
  if (!key || [...mods].some((mod) => !['ctrl', 'alt', 'shift', 'cmd', 'meta'].includes(mod))) return null;
  const name = key.length === 1 ? key.toUpperCase() : key;
  return `${mods.has('ctrl') || mods.has('cmd') || mods.has('meta') ? 'Ctrl+' : ''}${mods.has('alt') ? 'Alt+' : ''}${mods.has('shift') ? 'Shift+' : ''}${name}`;
}

/** The keys each command runs on: the defaults with the user's changes over them. */
export type Keymap = Record<string, string[]>;

export function keymapFrom(overrides: Record<string, string[]> | null | undefined): Keymap {
  const map: Keymap = {};
  for (const item of COMMANDS) {
    const changed = overrides?.[item.id];
    map[item.id] = Array.isArray(changed) ? [...new Set(changed.map(normalizeBinding).filter((key): key is string => !!key))] : [...item.keys];
  }
  return map;
}

/** Only what differs from the defaults: what Settings.shortcuts saves. */
export function overridesOf(map: Keymap): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const item of COMMANDS) {
    const keys = map[item.id] ?? [];
    if (keys.length !== item.keys.length || keys.some((key, index) => key !== item.keys[index])) out[item.id] = keys;
  }
  return out;
}

/** The command a key press runs, or null. */
export function commandFor(map: Keymap, event: KeyLike): string | null {
  const binding = bindingOf(event);
  if (!binding) return null;
  for (const item of COMMANDS) if (map[item.id]?.includes(binding)) return item.id;
  return null;
}

/** Commands other than `except` that already run on `binding`. */
export function usersOf(map: Keymap, binding: string, except?: string): Command[] {
  return COMMANDS.filter((item) => item.id !== except && map[item.id]?.includes(binding));
}

/** Every binding more than one command runs on, with those commands. */
export function conflicts(map: Keymap): Map<string, Command[]> {
  const byKey = new Map<string, Command[]>();
  for (const item of COMMANDS) for (const key of map[item.id] ?? []) byKey.set(key, [...(byKey.get(key) ?? []), item]);
  return new Map([...byKey].filter(([, users]) => users.length > 1));
}

/** Keys Windows or the app window keep for themselves: a shortcut there would never fire. */
const RESERVED: Record<string, string> = {
  'Alt+F4': 'closes the window',
  'Ctrl+Alt+Delete': 'belongs to Windows',
  'Alt+Tab': 'switches windows',
  F11: 'toggles full screen',
};

/** Why `binding` cannot be used, or null. */
export function refuseBinding(binding: string): string | null {
  const reserved = RESERVED[binding];
  return reserved ? `${display(binding)} ${reserved}.` : null;
}

const SYMBOLS: Record<string, string> = { Left: '←', Right: '→', Up: '↑', Down: '↓' };

/** A binding as the dialog shows it ("Shift+←"). */
export const display = (binding: string) => binding.split('+').map((part, index, all) => (index === all.length - 1 ? SYMBOLS[part] ?? part : part)).join('+');
