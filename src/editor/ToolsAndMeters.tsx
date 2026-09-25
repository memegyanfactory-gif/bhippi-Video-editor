// The Tools panel (Premiere's grouped tools with click-and-hold flyouts) and the Audio Meters
// panel (peaks, valleys, clip lights, and the right-click menu of display and monitoring options).
import {
  ArrowLeftRight, Circle, CircleDashed, Hand, MousePointer2, MoveHorizontal, PenLine, PenTool, Pentagon, ScanFace, Slice, Sparkles, UserRoundSearch, Square, SquareArrowLeft, SquareArrowRight, SquareDashed, Type, ZoomIn,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
    { id: 'remix', label: 'Remix Tool', icon: <Sparkles size={17} />, disabled: 'Remix retimes music with Adobe Sensei, which Helios does not have' },
  ],
  [{ id: 'razor', label: 'Razor Tool', key: 'C', icon: <Slice size={17} /> }],
  [
    { id: 'slip', label: 'Slip Tool', key: 'Y', icon: <ArrowLeftRight size={17} /> },
    { id: 'slide', label: 'Slide Tool', key: 'U', icon: <MoveHorizontal size={17} /> },
  ],
  [{ id: 'pen', label: 'Pen Tool', key: 'P', icon: <PenTool size={17} /> }],
  [
    { id: 'rectangle', label: 'Rectangle Tool', icon: <Square size={17} /> },
    { id: 'ellipse', label: 'Ellipse Tool', icon: <Circle size={17} /> },
    { id: 'polygon', label: 'Polygon Tool', icon: <Pentagon size={17} /> },
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

  const open = (group: number, element: HTMLElement) => setFlyout({ group, anchor: element.getBoundingClientRect() });

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
            className={`tool-button${active ? ' active' : ''}${group.length > 1 ? ' grouped' : ''}${shown.disabled ? ' unavailable' : ''}${shown.id === 'auto-roto' && rotoBusy ? ' busy' : ''}`}
            title={shown.id === 'auto-roto' && rotoBusy
              ? ((rotoProgress ?? 'Separating the subject…') + ' · click to cancel')
              : shown.disabled
                ? `${shown.label} — ${shown.disabled}`
                : `${shown.label}${shown.key ? ` (${shown.key})` : ''}${group.length > 1 ? ' · hold for more' : ''}`}
            aria-pressed={active}
            onPointerDown={(event) => {
              if (group.length < 2 || event.button !== 0) return;
              const element = event.currentTarget;
              window.clearTimeout(hold.current);
              hold.current = window.setTimeout(() => open(index, element), 350);
            }}
            onPointerUp={() => window.clearTimeout(hold.current)}
            onPointerLeave={() => window.clearTimeout(hold.current)}
            onClick={(event) => {
              if (flyout) return;
              if (shown.disabled) return group.length > 1 ? open(index, event.currentTarget) : undefined;
              // One slot is an action rather than a mode: it runs on the selection and returns.
              if (shown.id === 'auto-roto') return onAutoRoto();
              onTool(shown.id as Tool);
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
        <MenuList
          anchor={new DOMRect(flyout.anchor.right + 2, flyout.anchor.top - 2, 0, 0)}
          onClose={() => setFlyout(null)}
          items={GROUPS[flyout.group].map((item): MenuItem => ({
            label: item.label,
            shortcut: item.key,
            checked: item.id === tool,
            disabled: !!item.disabled,
            onSelect: () => onTool(item.id as Tool),
          }))}
        />
      )}
    </div>
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
        // Layout: a peak readout per channel on top, then two narrow LED columns, then the scale.
        const scaleWidth = 22;
        const gap = 3;
        const readoutHeight = 13;
        const barWidth = Math.max(6, Math.min(14, (width - scaleWidth - 4 - gap) / 2));
        const barsLeft = Math.max(2, (width - scaleWidth - (barWidth * 2 + gap)) / 2);
        const top = readoutHeight + 3;
        const usable = height - top - 2;
        const toY = (db: number) => top + ((0 - Math.min(0, Math.max(floor, db))) / (0 - floor)) * usable;
        const step = range >= 96 ? 12 : range >= 60 ? 6 : 3;

        // The colour of the scale itself: green to -18, yellow to -6, red above — lit where the
        // level is, faint everywhere else so the empty part of the scale still reads.
        const scale = ctx.createLinearGradient(0, top + usable, 0, top);
        scale.addColorStop(0, '#1f8a3b');
        scale.addColorStop(Math.max(0, Math.min(1, (-18 - floor) / -floor)), '#39c75a');
        scale.addColorStop(Math.max(0, Math.min(1, (-12 - floor) / -floor)), '#a7d63c');
        scale.addColorStop(Math.max(0, Math.min(1, (-6 - floor) / -floor)), '#f2c230');
        scale.addColorStop(Math.max(0, Math.min(1, (-3 - floor) / -floor)), '#f38a2e');
        scale.addColorStop(1, '#ef3f35');

        for (let channel = 0; channel < 2; channel++) {
          const peak = reading.peak[channel];
          // Instant attack, 24 dB/s release: fast enough to read transients, calm enough to follow.
          shown[channel] = peak >= shown[channel] ? peak : Math.max(peak, shown[channel] - 24 * dt);
          if (peak >= hold[channel]) {
            hold[channel] = peak;
            holdAt[channel] = now;
          } else if (peaks === 'dynamic' && now - holdAt[channel] > 1500) {
            hold[channel] = Math.max(shown[channel], hold[channel] - 12 * dt);
          }
          if (Number.isFinite(reading.valley[channel])) valley[channel] = !Number.isFinite(valley[channel]) || reading.valley[channel] < valley[channel] ? reading.valley[channel] : valley[channel] + 6 * dt;
          if (peak >= -0.1) clipped.current[channel] = true;
          const x = barsLeft + channel * (barWidth + gap);

          // The empty well, then the whole scale faintly over it.
          ctx.fillStyle = '#0a0a0b';
          ctx.fillRect(x, top, barWidth, usable);
          ctx.globalAlpha = 0.13;
          ctx.fillStyle = scale;
          ctx.fillRect(x, top, barWidth, usable);
          ctx.globalAlpha = 1;

          // The level, lit.
          const level = shown[channel];
          if (Number.isFinite(level) && level > floor) {
            const y = toY(level);
            if (colorGradient) {
              ctx.fillStyle = scale;
              ctx.fillRect(x, y, barWidth, top + usable - y);
            } else {
              const zones: [number, number, string][] = [[floor, -18, '#39c75a'], [-18, -6, '#f2c230'], [-6, 0, '#ef3f35']];
              for (const [from, to, color] of zones) {
                if (level <= from) continue;
                const yTop = toY(Math.min(level, to));
                ctx.fillStyle = color;
                ctx.fillRect(x, yTop, barWidth, toY(from) - yTop);
              }
            }
          }
          // LED segments: a hairline of the well every 3 px across lit and unlit alike.
          ctx.fillStyle = 'rgba(10, 10, 11, 0.85)';
          for (let y = top + usable - 3; y > top; y -= 3) ctx.fillRect(x, y, barWidth, 1);

          if (Number.isFinite(hold[channel]) && hold[channel] > floor) {
            ctx.fillStyle = hold[channel] > -3 ? '#ff6a5f' : '#f2f2f2';
            ctx.fillRect(x, toY(hold[channel]) - 1, barWidth, 2);
          }
          if (showValleys && Number.isFinite(valley[channel]) && valley[channel] > floor) {
            ctx.fillStyle = '#4ea3ff';
            ctx.fillRect(x, toY(valley[channel]) - 1, barWidth, 2);
          }

          // Peak readout, which is also the clip light: red once the channel has clipped.
          const over = clipped.current[channel];
          ctx.fillStyle = over ? '#c9261d' : '#161618';
          ctx.fillRect(x - 1, 1, barWidth + 2, readoutHeight);
          ctx.fillStyle = over ? '#fff' : Number.isFinite(hold[channel]) && hold[channel] > -6 ? '#f2c230' : '#c8ccd2';
          ctx.font = '600 9px Segoe UI, system-ui, sans-serif';
          ctx.textAlign = 'center';
          const readout = Number.isFinite(hold[channel]) && hold[channel] > floor ? (hold[channel] >= -0.05 ? '0' : hold[channel].toFixed(hold[channel] > -10 ? 1 : 0)) : '-∞';
          ctx.fillText(readout.replace('-', '−'), x + barWidth / 2, readoutHeight - 2);
        }

        // Scale: a tick and a faint line across both columns at each mark, numbers on the right.
        const scaleX = barsLeft + barWidth * 2 + gap;
        ctx.font = '9px Segoe UI, system-ui, sans-serif';
        ctx.textAlign = 'right';
        for (let mark = 0; mark >= floor; mark -= step) {
          const y = Math.round(toY(mark));
          ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
          ctx.fillRect(barsLeft, y, scaleX - barsLeft, 1);
          ctx.fillStyle = '#5c6068';
          ctx.fillRect(scaleX + 2, y, 3, 1);
          ctx.fillStyle = mark === 0 ? '#e6e6e6' : '#8b9099';
          ctx.fillText(mark === 0 ? '0' : `−${-mark}`, width - 1, Math.min(height - 2, Math.max(top + 7, y + 3)));
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
        // Clicking the peak readouts (which are the clip lights) resets them, as in Premiere.
        if (event.nativeEvent.offsetY < 16) reset.current++;
      }} />
      <div className="meter-foot">
        <button type="button" className={`meter-solo${mutes.all ? ' on' : ''}`} onClick={() => onMutes({ ...mutes, all: !mutes.all })} title="Mute All Audio">M</button>
        <span className="meter-channels"><span>L</span><span>R</span></span>
        <span className="meter-unit">dB</span>
      </div>
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
