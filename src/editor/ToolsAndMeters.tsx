// The Tools panel (Premiere's grouped tools with click-and-hold flyouts) and the Audio Meters
// panel (peaks, valleys, clip lights, and the right-click menu of display and monitoring options).
import {
  ArrowLeftRight, Circle, CircleDashed, Hand, MousePointer2, MoveHorizontal, PenLine, PenTool, Pentagon, ScanFace, Slice, Sparkles, UserRoundSearch, Square, SquareArrowLeft, SquareArrowRight, SquareDashed, Type, ZoomIn,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MenuList, type MenuItem } from '../components/workspace';
import { levels, type MuteState } from '../lib/audio';
import type { MeterPrefs, Tool } from '../lib/types';

type ToolDef = { id: Tool | 'remix' | 'mask-object' | 'auto-roto'; label: string; key?: string; icon: ReactNode; disabled?: string };

const RippleGlyph = () => <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 3v11M11 3v11M1 8.5h4M3 6.5l-2 2 2 2M12 8.5h4M14 6.5l2 2-2 2" /></svg>;
const RollingGlyph = () => <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 3v11M10 3v11M1 8.5h5M3 6.5l-2 2 2 2M11 8.5h5M14 6.5l2 2-2 2" /></svg>;
const VerticalType = () => <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 3h9M7.5 3v11M14 7v7M12 12l2 2 2-2" /></svg>;

const GROUPS: ToolDef[][] = [
  [{ id: 'select', label: 'Selection Tool', key: 'V', icon: <MousePointer2 size={17} /> }],
  [
    { id: 'track-forward', label: 'Track Select Forward Tool', key: 'A', icon: <SquareArrowRight size={17} /> },
    { id: 'track-backward', label: 'Track Select Backward Tool', key: 'Shift+A', icon: <SquareArrowLeft size={17} /> },
  ],
  [
    { id: 'ripple', label: 'Ripple Edit Tool', key: 'B', icon: <RippleGlyph /> },
    { id: 'rolling', label: 'Rolling Edit Tool', key: 'N', icon: <RollingGlyph /> },
    { id: 'rate-stretch', label: 'Rate Stretch Tool', key: 'R', icon: <MoveHorizontal size={17} /> },
    { id: 'remix', label: 'Remix Tool', icon: <Sparkles size={17} />, disabled: 'Remix retimes music with Adobe Sensei, which Bhippi does not have' },
  ],
  [{ id: 'razor', label: 'Razor Tool', key: 'C', icon: <Slice size={17} /> }],
  [
    { id: 'slip', label: 'Slip Tool', key: 'Y', icon: <ArrowLeftRight size={17} /> },
    { id: 'slide', label: 'Slide Tool', key: 'U', icon: <MoveHorizontal size={17} /> },
  ],
  [{ id: 'pen', label: 'Pen Tool', key: 'P', icon: <PenTool size={17} /> }],
  [
    { id: 'rectangle', label: 'Rectangle Tool', icon: <Square size={17} fill="currentColor" /> },
    { id: 'ellipse', label: 'Ellipse Tool', icon: <Circle size={17} fill="currentColor" /> },
    { id: 'polygon', label: 'Polygon Tool', icon: <Pentagon size={17} fill="currentColor" /> },
  ],
  [
    { id: 'mask-rectangle', label: 'Rectangle Mask Tool', icon: <SquareDashed size={17} /> },
    { id: 'mask-ellipse', label: 'Ellipse Mask Tool', icon: <CircleDashed size={17} /> },
    { id: 'mask-pen', label: 'Pen Mask Tool', icon: <PenLine size={17} /> },
    { id: 'roto', label: 'Roto Tool', icon: <UserRoundSearch size={17} /> },
    { id: 'magic-mask', label: 'Magic Mask', icon: <ScanFace size={17} /> },
  ],
  [
    { id: 'hand', label: 'Hand Tool', key: 'H', icon: <Hand size={17} /> },
    { id: 'zoom', label: 'Zoom Tool', key: 'Z', icon: <ZoomIn size={17} /> },
  ],
  [
    { id: 'type', label: 'Type Tool', key: 'T', icon: <Type size={17} /> },
    { id: 'vertical-type', label: 'Vertical Type Tool', icon: <VerticalType /> },
  ],
  [{ id: 'auto-roto', label: 'Roto the selected clip', icon: <Sparkles size={17} /> }],
];

export const TOOL_LABEL: Record<Tool, string> = Object.fromEntries(GROUPS.flat().filter((tool) => !tool.disabled).map((tool) => [tool.id, tool.label])) as Record<Tool, string>;

export function ToolsPanel({ tool, onTool, onAutoRoto, rotoBusy, rotoProgress }: {
  tool: Tool;
  onTool: (tool: Tool) => void;
  /** Separates the selected clip's subject from its background. */
  onAutoRoto: () => void;
  rotoBusy: boolean;
  /** What the matting pass is doing, shown on the button while it runs. */
  rotoProgress?: string | null;
}) {
  // Each group remembers which of its tools was used last, like Premiere's tool slots.
  const [current, setCurrent] = useState<Record<number, number>>({});
  const [flyout, setFlyout] = useState<{ group: number; anchor: DOMRect } | null>(null);
  const hold = useRef(0);

  useEffect(() => {
    const index = GROUPS.findIndex((group) => group.some((item) => item.id === tool));
    if (index >= 0) setCurrent((value) => ({ ...value, [index]: GROUPS[index].findIndex((item) => item.id === tool) }));
  }, [tool]);

  const open = (group: number, element: HTMLElement) => {
    window.clearTimeout(hold.current);
    setFlyout({ group, anchor: element.getBoundingClientRect() });
  };
  const choose = (item: ToolDef) => {
    setFlyout(null);
    if (item.disabled) return;
    // One slot is an action rather than a mode: it runs on the selection and returns.
    if (item.id === 'auto-roto') return onAutoRoto();
    onTool(item.id as Tool);
  };

  return (
    <div className="tools-panel" role="toolbar" aria-orientation="vertical" aria-label="Tools">
      {GROUPS.map((group, index) => {
        // Open on the first tool that works, so a group led by an unavailable tool still does
        // something when it is clicked.
        const shown = group[current[index] ?? Math.max(0, group.findIndex((item) => !item.disabled))] ?? group[0];
        const active = group.some((item) => item.id === tool);
        return (
          <button
            key={index}
            type="button"
            className={`tool-button${active ? ' active' : ''}${group.length > 1 ? ' grouped' : ''}${shown.disabled ? ' unavailable' : ''}${shown.id === 'auto-roto' && rotoBusy ? ' busy' : ''}${flyout?.group === index ? ' open' : ''}`}
            title={shown.id === 'auto-roto' && rotoBusy
              ? ((rotoProgress ?? 'Separating the subject…') + ' · click to cancel')
              : shown.disabled
                ? `${shown.label} — ${shown.disabled}`
                : `${shown.label}${shown.key ? ` (${shown.key})` : ''}${group.length > 1 ? ' · hold for more' : ''}`}
            aria-pressed={active}
            aria-haspopup={group.length > 1 ? 'menu' : undefined}
            aria-expanded={group.length > 1 ? flyout?.group === index : undefined}
            onPointerDown={(event) => {
              if (group.length < 2 || event.button !== 0) return;
              const element = event.currentTarget;
              // Pointer capture would pin the release to this button; drop it so dragging onto
              // the flyout and letting go picks that tool, as in Premiere.
              if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
              window.clearTimeout(hold.current);
              hold.current = window.setTimeout(() => open(index, element), 300);
            }}
            onPointerUp={() => window.clearTimeout(hold.current)}
            onPointerLeave={() => window.clearTimeout(hold.current)}
            onClick={(event) => {
              if (flyout?.group === index) return;
              if (shown.disabled) return group.length > 1 ? open(index, event.currentTarget) : undefined;
              choose(shown);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              if (group.length > 1) open(index, event.currentTarget);
            }}
          >
            {shown.icon}
          </button>
        );
      })}
      {flyout && (
        <ToolFlyout
          anchor={flyout.anchor}
          items={GROUPS[flyout.group]}
          tool={tool}
          onChoose={choose}
          onClose={() => setFlyout(null)}
        />
      )}
    </div>
  );
}

/** Premiere's tool flyout: each tool's icon, name and shortcut, with a marker on the one in use.
 *  Opens on click-and-hold or right-click; releasing over a tool after a hold picks it. */
function ToolFlyout({ anchor, items, tool, onChoose, onClose }: {
  anchor: DOMRect;
  items: ToolDef[];
  tool: Tool;
  onChoose: (item: ToolDef) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: anchor.right + 4, top: anchor.top - 4 });
  const [focus, setFocus] = useState(() => Math.max(0, items.findIndex((item) => item.id === tool)));
  const opened = useRef(performance.now());
  const latest = useRef({ onChoose, onClose });
  latest.current = { onChoose, onClose };

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const left = Math.max(4, Math.min(anchor.right + 4, window.innerWidth - node.offsetWidth - 4));
    const top = Math.max(4, Math.min(anchor.top - 4, window.innerHeight - node.offsetHeight - 4));
    setPosition({ left, top });
    node.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    const down = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) latest.current.onClose();
    };
    // The release that ends a hold: over a tool it picks that tool; anywhere else the flyout
    // stays open for an ordinary click.
    const up = (event: PointerEvent) => {
      if (event.button !== 0 || performance.now() - opened.current < 120) return;
      const row = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-tool-index]');
      if (!row || !ref.current?.contains(row)) return;
      const item = items[Number(row.dataset.toolIndex)];
      if (item && !item.disabled) latest.current.onChoose(item);
    };
    const key = (event: KeyboardEvent) => event.key === 'Escape' && latest.current.onClose();
    const blur = () => latest.current.onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', blur);
    };
  }, [items]);

  const move = (step: number) => {
    let next = focus;
    for (let i = 0; i < items.length; i++) {
      next = (next + step + items.length) % items.length;
      if (!items[next].disabled) break;
    }
    setFocus(next);
  };

  return createPortal(
    <div
      ref={ref}
      className="tool-flyout"
      role="menu"
      tabIndex={-1}
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
        else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onChoose(items[focus]); }
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="menuitemradio"
          aria-checked={item.id === tool}
          data-tool-index={index}
          tabIndex={-1}
          className={`tool-flyout-item${index === focus ? ' focused' : ''}`}
          disabled={!!item.disabled}
          title={item.disabled}
          onPointerEnter={() => !item.disabled && setFocus(index)}
          onClick={() => onChoose(item)}
        >
          <span className={`tool-flyout-mark${item.id === tool ? ' on' : ''}`} />
          <span className="tool-flyout-icon">{item.icon}</span>
          <span className="tool-flyout-label">{item.label}</span>
          {item.key && <span className="tool-flyout-key">{item.key}</span>}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export const DEFAULT_METERS: MeterPrefs = { range: 60, showValleys: false, colorGradient: true, peaks: 'dynamic' };

/** Peak meters for everything the editor plays: ballistics, peak hold, valleys, clip lights. */
export function AudioMeters({ prefs, onPrefs, mutes, onMutes }: { prefs: MeterPrefs; onPrefs: (prefs: MeterPrefs) => void; mutes: MuteState; onMutes: (mutes: MuteState) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const clipped = useRef<[boolean, boolean]>([false, false]);
  const reset = useRef(0);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const shown = [-Infinity, -Infinity];
    const hold = [-Infinity, -Infinity];
    const holdAt = [0, 0];
    const valley = [-Infinity, -Infinity];
    let resetSeen = reset.current;
    const draw = (now: number) => {
      const node = canvas.current;
      const ctx = node?.getContext('2d');
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (resetSeen !== reset.current) {
        resetSeen = reset.current;
        hold.fill(-Infinity);
        valley.fill(-Infinity);
        clipped.current = [false, false];
      }
      if (node && ctx) {
        const { range, showValleys, colorGradient, peaks } = prefsRef.current;
        const floor = -range;
        const ratio = window.devicePixelRatio || 1;
        const width = node.clientWidth;
        const height = node.clientHeight;
        if (node.width !== Math.round(width * ratio) || node.height !== Math.round(height * ratio)) {
          node.width = Math.round(width * ratio);
          node.height = Math.round(height * ratio);
        }
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const reading = levels();
        // Layout, as Premiere draws it: a clip light per channel on top, two black wells side by
        // side, the scale on the right ending in "dB", and a solo label under each well.
        const scaleWidth = 24;
        const gap = 1;
        const clipHeight = 6;
        const footHeight = 13;
        const barWidth = Math.floor(Math.max(6, Math.min(22, (width - scaleWidth - 2 - gap) / 2)));
        const barsLeft = Math.round(Math.max(1, (width - scaleWidth - (barWidth * 2 + gap)) / 2));
        const top = clipHeight + 3;
        const usable = height - top - footHeight;
        const toY = (db: number) => top + ((0 - Math.min(0, Math.max(floor, db))) / (0 - floor)) * usable;
        const step = range >= 96 ? 12 : range >= 48 ? 6 : 3;

        // Green up to -18, through yellow around -6, red at the top.
        const scale = ctx.createLinearGradient(0, top + usable, 0, top);
        const stop = (db: number) => Math.max(0, Math.min(1, (db - floor) / -floor));
        scale.addColorStop(0, '#2f8f3c');
        scale.addColorStop(stop(-18), '#48e452');
        scale.addColorStop(stop(-9), '#b9e23a');
        scale.addColorStop(stop(-6), '#f2d02e');
        scale.addColorStop(stop(-3), '#f28a2c');
        scale.addColorStop(1, '#ea3329');

        // The frame both wells sit in.
        ctx.fillStyle = '#2b2b2d';
        ctx.fillRect(barsLeft - 1, top - 1, barWidth * 2 + gap + 2, usable + 2);

        for (let channel = 0; channel < 2; channel++) {
          const peak = reading.peak[channel];
          // Instant attack and a fast release; silence (playback stopped) empties the bar at once
          // instead of letting it drift down.
          shown[channel] = !Number.isFinite(peak) || peak <= floor
            ? -Infinity
            : peak >= shown[channel] ? peak : Math.max(peak, shown[channel] - 150 * dt);
          if (peak >= hold[channel]) {
            hold[channel] = peak;
            holdAt[channel] = now;
          } else if (peaks === 'dynamic' && now - holdAt[channel] > 1000) {
            // After a second the hold snaps to wherever the level is now.
            hold[channel] = shown[channel];
            holdAt[channel] = now;
          }
          if (Number.isFinite(reading.valley[channel])) valley[channel] = !Number.isFinite(valley[channel]) || reading.valley[channel] < valley[channel] ? reading.valley[channel] : valley[channel] + 6 * dt;
          if (peak >= -0.1) clipped.current[channel] = true;
          const x = barsLeft + channel * (barWidth + gap);

          ctx.fillStyle = '#000';
          ctx.fillRect(x, top, barWidth, usable);

          const level = shown[channel];
          if (Number.isFinite(level) && level > floor) {
            const y = Math.round(toY(level));
            if (colorGradient) {
              ctx.fillStyle = scale;
              ctx.fillRect(x, y, barWidth, top + usable - y);
            } else {
              const zones: [number, number, string][] = [[floor, -18, '#3fd34b'], [-18, -6, '#f2c230'], [-6, 0, '#ef3f35']];
              for (const [from, to, color] of zones) {
                if (level <= from) continue;
                const yTop = Math.round(toY(Math.min(level, to)));
                ctx.fillStyle = color;
                ctx.fillRect(x, yTop, barWidth, Math.round(toY(from)) - yTop);
              }
            }
          }

          if (Number.isFinite(hold[channel]) && hold[channel] > floor) {
            ctx.fillStyle = hold[channel] > -3 ? '#ff5a4f' : '#f2f2f2';
            ctx.fillRect(x, Math.round(toY(hold[channel])), barWidth, 1);
          }
          if (showValleys && Number.isFinite(valley[channel]) && valley[channel] > floor) {
            ctx.fillStyle = '#4ea3ff';
            ctx.fillRect(x, Math.round(toY(valley[channel])), barWidth, 1);
          }

          // The clip light: dark until the channel clips, then red until reset.
          ctx.fillStyle = clipped.current[channel] ? '#e0261c' : '#3a3a3c';
          ctx.fillRect(x, 1, barWidth, clipHeight);

          // The solo label under the well.
          ctx.fillStyle = '#8b8f96';
          ctx.font = '600 9px Segoe UI, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('S', x + barWidth / 2, height - 2);
        }

        // Scale: a rule down its left edge, a tick at each mark, numbers right-aligned, and the
        // bottom mark labelled "dB".
        const scaleX = barsLeft + barWidth * 2 + gap + 3;
        ctx.fillStyle = '#4a4c52';
        ctx.fillRect(scaleX, top, 1, usable);
        ctx.font = '9px Segoe UI, system-ui, sans-serif';
        ctx.textAlign = 'right';
        for (let mark = 0; mark >= floor; mark -= step) {
          const y = Math.round(toY(mark));
          ctx.fillStyle = '#6a6e76';
          ctx.fillRect(scaleX + 1, y, 3, 1);
          ctx.fillStyle = '#9a9ea6';
          const label = mark === floor ? 'dB' : mark === 0 ? '0' : `−${-mark}`;
          ctx.fillText(label, width - 1, Math.min(height - footHeight + 4, Math.max(top + 3, y + 3)));
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  const set = (patch: Partial<MeterPrefs>) => onPrefs({ ...prefs, ...patch });

  return (
    <div className="meters" onContextMenu={(event) => { event.preventDefault(); setMenu(new DOMRect(event.clientX, event.clientY, 0, 0)); }}>
      <canvas ref={canvas} className="meter-canvas" aria-label="Audio levels" onClick={(event) => {
        // Clicking the clip lights resets them and the peak holds, as in Premiere.
        if (event.nativeEvent.offsetY < 9) reset.current++;
      }} />
      {menu && (
        <MenuList anchor={menu} onClose={() => setMenu(null)} items={[
          { label: 'Reset Indicators', onSelect: () => reset.current++ },
          { label: 'Show Valleys', checked: prefs.showValleys, onSelect: () => set({ showValleys: !prefs.showValleys }) },
          { label: 'Show Color Gradient', checked: prefs.colorGradient, onSelect: () => set({ colorGradient: !prefs.colorGradient }) },
          { separator: true },
          { label: 'Mute All Audio', checked: mutes.all, onSelect: () => onMutes({ ...mutes, all: !mutes.all }) },
          { label: 'Mute Source Monitor', checked: mutes.source, onSelect: () => onMutes({ ...mutes, source: !mutes.source }) },
          { label: 'Mute Program Monitor', checked: mutes.program, onSelect: () => onMutes({ ...mutes, program: !mutes.program }) },
          { separator: true },
          { label: 'Solo in Place', disabled: true, checked: true },
          { label: 'Monitor Mono Channels', disabled: true },
          { label: 'Monitor Stereo Pairs', disabled: true },
          { separator: true },
          ...([120, 96, 72, 60, 48, 24] as const).map((range): MenuItem => ({ label: `${range} dB Range`, checked: prefs.range === range, onSelect: () => set({ range }) })),
          { separator: true },
          { label: 'Dynamic Peaks', checked: prefs.peaks === 'dynamic', onSelect: () => set({ peaks: 'dynamic' }) },
          { label: 'Static Peaks', checked: prefs.peaks === 'static', onSelect: () => set({ peaks: 'static' }) },
        ]} />
      )}
    </div>
  );
}
