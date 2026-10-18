// QWERTY → semitones above the row's base note: the Z row starts at C3, the Q row at C4; the black
// keys sit on S D G H J and 2 3 5 6 7. Keys are matched by physical position (KeyboardEvent.code).
const LOWER: Record<string, number> = { KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12 };
const UPPER: Record<string, number> = { KeyQ: 0, Digit2: 1, KeyW: 2, Digit3: 3, KeyE: 4, KeyR: 5, Digit5: 6, KeyT: 7, Digit6: 8, KeyY: 9, Digit7: 10, KeyU: 11, KeyI: 12 };

/** The MIDI key a physical key plays, or null when it is not a piano key. */
export function pianoKey(code: string): number | null {
  if (LOWER[code] !== undefined) return 48 + LOWER[code];
  if (UPPER[code] !== undefined) return 60 + UPPER[code];
  return null;
}
