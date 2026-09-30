// The Bhippi mark as data, in its 100-unit view box: the chat's live mark (src/chat/BhippiMark.tsx)
// and the motion kit's glass mark and connect hub (src/motion/kit/filmTemplates.ts) draw the same
// two ring halves and B, so the logo in a film is the logo in the app.

/** The two halves: 17-unit strokes on a 38.5 radius, 9° either side of the gaps. */
export const MARK_LEFT = 'M43.98 88.03A38.5 38.5 0 0 1 43.98 11.97';
export const MARK_RIGHT = 'M56.02 11.97A38.5 38.5 0 0 1 56.02 88.03';
/** The B, with the notched lower bowl of the logo. */
export const MARK_B = 'M43 35H53C58.5 35 61 38.5 61 42.5C61 45.5 59.5 47.5 57 49.5L54 52.5L58.5 56C61.5 58.5 62.5 60.5 62.5 63C62.5 67 59.5 70 54.5 70H43C40.5 70 39 68.5 39 66V39C39 36.5 40.5 35 43 35Z';

export const MARK_STROKE = 17;

/** Ember gradients (offset, colour), in view-box units along the given line. */
export const MARK_RING = { from: [14, 6], to: [86, 96], stops: [[0, '#ffc06a'], [0.3, '#ff8a24'], [0.72, '#e5560d'], [1, '#a9320a']] as [number, string][] };
export const MARK_LETTER = { from: [39, 35], to: [62.5, 70], stops: [[0, '#ffab52'], [0.6, '#ef6512'], [1, '#b93b0b']] as [number, string][] };
