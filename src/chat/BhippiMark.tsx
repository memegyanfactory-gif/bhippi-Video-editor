// The Bhippi mark as a vector, so the assistant's own logo can say what it is doing.
//
// The logo is two halves of a ring around a B, split at the top and bottom. That split is the whole
// motion system: the halves open and turn while it thinks, tick forward a quarter at a time like a
// reel while tools change the timeline, swing shut once when the turn is done, hold apart when it
// is waiting on you, and go grey when it was stopped. The same two arcs, drawn thin, are the running
// step's circle (StatusDot) and the orbit round the stop button, so everything that moves while
// Bhippi works moves the same way. Only transforms animate, so it is cheap at 16px.
import { useId } from 'react';
import '../styles/bhippi-mark.css';

export type MarkState = 'idle' | 'thinking' | 'editing' | 'done' | 'waiting' | 'stopped';

/** The two halves: 17-unit strokes on a 38.5 radius, 9° either side of the gaps. */
const LEFT = 'M43.98 88.03A38.5 38.5 0 0 1 43.98 11.97';
const RIGHT = 'M56.02 11.97A38.5 38.5 0 0 1 56.02 88.03';
/** The B, with the notched lower bowl of the logo. */
const B = 'M43 35H53C58.5 35 61 38.5 61 42.5C61 45.5 59.5 47.5 57 49.5L54 52.5L58.5 56C61.5 58.5 62.5 60.5 62.5 63C62.5 67 59.5 70 54.5 70H43C40.5 70 39 68.5 39 66V39C39 36.5 40.5 35 43 35Z';

export function BhippiMark({ state = 'idle', size = 20, className = '' }: { state?: MarkState; size?: number; className?: string }) {
  // Gradients are looked up by id across the whole document, so each mark names its own.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ring = `${id}-ring`, light = `${id}-light`, letter = `${id}-b`;
  return (
    <svg className={`mk ${className}`} data-s={state} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={ring} gradientUnits="userSpaceOnUse" x1="14" y1="6" x2="86" y2="96">
          <stop offset="0" stopColor="#ffc06a" />
          <stop offset="0.3" stopColor="#ff8a24" />
          <stop offset="0.72" stopColor="#e5560d" />
          <stop offset="1" stopColor="#a9320a" />
        </linearGradient>
        <linearGradient id={light} gradientUnits="userSpaceOnUse" x1="18" y1="8" x2="82" y2="92">
          <stop offset="0" stopColor="#fff4dc" stopOpacity="0.95" />
          <stop offset="0.45" stopColor="#ffb35c" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ff7a1a" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={letter} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffab52" />
          <stop offset="0.6" stopColor="#ef6512" />
          <stop offset="1" stopColor="#b93b0b" />
        </linearGradient>
      </defs>
      <g className="mk-ring">
        <g className="mk-half mk-l">
          <path className="mk-arc" d={LEFT} stroke={`url(#${ring})`} />
          <path className="mk-hl" d={LEFT} stroke={`url(#${light})`} />
        </g>
        <g className="mk-half mk-r">
          <path className="mk-arc" d={RIGHT} stroke={`url(#${ring})`} />
          <path className="mk-hl" d={RIGHT} stroke={`url(#${light})`} />
        </g>
      </g>
      <path className="mk-b" d={B} fill={`url(#${letter})`} />
    </svg>
  );
}

export type DotState = 'queued' | 'running' | 'done' | 'failed' | 'denied' | 'waiting' | 'stopped';

const DOT_LABEL: Record<DotState, string> = {
  queued: 'Waiting to start',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  denied: 'Not allowed',
  waiting: 'Waiting on you',
  stopped: 'Stopped',
};

/**
 * A step's circle. Running is the mark's two halves drawn thin and turning; done closes them into a
 * ring and draws a tick; failed and not-allowed cross it out; waiting on you is the editor's blue.
 */
export function StatusDot({ state, size = 16 }: { state: DotState; size?: number }) {
  return (
    <span className="sd" data-state={state} style={{ width: size, height: size }} role="img" aria-label={DOT_LABEL[state]}>
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle className="sd-bg" cx="8" cy="8" r="7" />
        <circle className="sd-track" cx="8" cy="8" r="6.5" />
        <g className="sd-spin">
          <path d="M10.22 1.89A6.5 6.5 0 0 1 10.22 14.11" />
          <path d="M5.78 14.11A6.5 6.5 0 0 1 5.78 1.89" />
        </g>
        <circle className="sd-ring" cx="8" cy="8" r="6.5" pathLength={100} transform="rotate(-90 8 8)" />
        <path className="sd-tick" d="M5.2 8.3l1.9 1.9 3.8-4.1" pathLength={100} />
        <path className="sd-x" d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2" pathLength={100} />
        <circle className="sd-core" cx="8" cy="8" r="2.3" />
      </svg>
    </span>
  );
}

/** The stop button's face: a square with the mark's two halves orbiting it while the turn runs. */
export function StopGlyph() {
  return (
    <svg className="stop-glyph" width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" focusable="false">
      <rect x="10.5" y="10.5" width="9" height="9" rx="2.2" />
      <g className="stop-orbit">
        <path d="M19.4 2.9A12.9 12.9 0 0 1 19.4 27.1" />
        <path d="M10.6 27.1A12.9 12.9 0 0 1 10.6 2.9" />
      </g>
    </svg>
  );
}
